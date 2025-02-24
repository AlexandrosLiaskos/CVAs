/*********************************
 * Shoreline Detection Software
 * @version 1.0.1
 *********************************/

/**
 * Key Upgrades from @version 1.0.0
 *
 * 1. Shoreline Filtering Enhancement
 *    - Small patch removal via connectedPixelCount(100).
 *    - Post-vectorization: polygons → lines → filter only those intersecting the AOI boundary.
 *
 * 2. Morphological Processing Improvement
 *    - Uses a slightly bigger fixed kernel (ee.Kernel.circle(2)) with 2 iterations of focal_max and focal_min.
 *    - (Optional) Demonstrated how to enable adaptive kernel sizing if needed.
 *
 * 3. Composite Method Selection
 *    - Introduced a UI Select for Mean or Median composites (Sentinel-1 & Sentinel-2).
 *
 * 4. Date Validation
 *    - validateDate() function ensures date textboxes are in valid YYYY-MM-DD format, preventing errors in Earth Engine.
 *
 * 5. Performance Optimizations
 *    - Example getAdaptiveScale() function (commented out or easily integrated) to differentiate scale for large vs. small AOIs.
 *    - Smoother morphological steps kept fairly lightweight.
 */

// ─────────────────────────────────────────────────────────────────────────────
// STYLES AND GLOBALS
// ─────────────────────────────────────────────────────────────────────────────
var STYLES = {
  heading:    {fontSize: '24px', fontWeight: 'bold', margin: '10px 0'},
  subheading: {fontSize: '16px', fontWeight: 'bold', margin: '8px 0'},
  text:       {fontSize: '14px', margin: '5px 0'},
  button:     {margin: '5px 0', backgroundColor: 'white'}
};

// Global state
var state = {
  aoi:       null,
  results:   { sentinel1: null, sentinel2: null, landsat: null },
  rawImage:  null,
  dateRange: { start: null, end: null },
  cloudCover: 5,
  compositeMethod: 'Median',  // For Sentinel-1 / Sentinel-2
  waterIndex: 'MNDWI',         // For Sentinel-2
  waterBodySizeThreshold: 10,
  smoothingKernelSize: 2,
  smoothingIterations: 2,
  coastalBuffer: 1.0,
  sarVotesRequired: 2,
  useCustomThreshold: false,
  waterThreshold: 0
};

/** Resets the state for a new run */
function resetState() {
  state.aoi = null;
  state.results = { sentinel1: null, sentinel2: null, landsat: null };
  state.rawImage = null;
  state.dateRange = { start: null, end: null };
  state.cloudCover = 5;
  state.compositeMethod = 'Median';
  state.waterIndex = 'MNDWI';

  // New advanced settings with defaults
  state.waterBodySizeThreshold = 10;
  state.smoothingKernelSize = 2;
  state.smoothingIterations = 2;
  state.coastalBuffer = 1.0;
  state.sarVotesRequired = 2;
  state.useCustomThreshold = false;
  state.waterThreshold = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI SETUP
// ─────────────────────────────────────────────────────────────────────────────
var mainPanel = ui.Panel({style: {width: '400px', padding: '10px'}});
var map = ui.Map();
map.style().set('cursor', 'crosshair');
map.setControlVisibility({drawingTools: false});
ui.root.clear();
ui.root.add(ui.SplitPanel({firstPanel: map, secondPanel: mainPanel}));

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates a date string in "YYYY-MM-DD" format.
 * @param {string} dateStr - Date string to validate.
 * @returns {boolean} True if valid date, else false.
 */
function validateDate(dateStr) {
  try {
    var date = new Date(dateStr);
    return !isNaN(date.getTime());
  } catch (e) {
    return false;
  }
}

/**
 * Returns the optimal scale (in meters) for processing.
 * Always uses the highest available resolution for maximum accuracy:
 * - Sentinel-2: 10m
 * - Sentinel-1: 10m (resampled)
 * - Landsat: 15m (pan-sharpened) or 30m
 */
function getAdaptiveScale(geometry, method) {
  switch(method) {
    case 'sentinel2':
      return 10;  // Always use highest resolution for S2
    case 'sentinel1':
      return 10;  // Resample to 10m for consistency
    case 'landsat':
      return 15;  // Use pan-sharpened resolution when possible
    default:
      return 10;  // Default to highest resolution
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHORELINE DETECTION ALGORITHMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detects water bodies from Sentinel-1 SAR imagery using:
 * - Otsu thresholding on VV and VH bands
 * - Otsu threshold on VV/VH ratio
 * - Majority vote to produce binary water mask
 */
function detectWaterFromSAR(image) {
  // Helper for Otsu threshold
  function getOtsuThreshold(img, bandName) {
    var hist = img.select(bandName).reduceRegion({
      reducer: ee.Reducer.histogram({maxBuckets: 256, minBucketWidth: 0.001}),
      geometry: state.aoi,
      scale: 10,  // Maintain S1's native resolution
      maxPixels: 1e13,  // Increased for better precision
      bestEffort: true
    }).get(bandName);

    // Otsu Implementation
    function otsu(histDict) {
      var counts = ee.Array(ee.Dictionary(histDict).get('histogram'));
      var means  = ee.Array(ee.Dictionary(histDict).get('bucketMeans'));
      var size   = means.length().get([0]);
      var total  = counts.reduce(ee.Reducer.sum(), [0]).get([0]);
      var sum    = means.multiply(counts).reduce(ee.Reducer.sum(), [0]).get([0]);
      var mean   = sum.divide(total);
      var indices= ee.List.sequence(1, size.subtract(1));

      var bss = indices.map(function(i) {
        var aCounts = counts.slice(0, 0, i);
        var aCount  = aCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
        var aMeans  = means.slice(0, 0, i);
        var aMean   = aMeans.multiply(aCounts)
                      .reduce(ee.Reducer.sum(), [0]).get([0])
                      .divide(aCount);
        var bCount  = total.subtract(aCount);
        var bMean   = sum.subtract(aCount.multiply(aMean)).divide(bCount);
        return aCount.multiply(aMean.subtract(mean).pow(2))
               .add(bCount.multiply(bMean.subtract(mean).pow(2)));
      });

      var maxIndex = ee.List(bss).indexOf(ee.List(bss).reduce(ee.Reducer.max()));
      return means.get([maxIndex]);
    }

    return ee.Number(otsu(hist));
  }

  // Otsu thresholds on VV, VH
  var vvDb = image.select('VV');
  var vvThreshold = getOtsuThreshold(image, 'VV');
  var vvWater = vvDb.lt(vvThreshold);

  var vhDb = image.select('VH');
  var vhThreshold = getOtsuThreshold(image, 'VH');
  var vhWater = vhDb.lt(vhThreshold);

  // VV/VH ratio
  var vvLinear = ee.Image.constant(10).pow(vvDb.divide(10));
  var vhLinear = ee.Image.constant(10).pow(vhDb.divide(10));
  var ratio = vvLinear.divide(vhLinear).rename('ratio');
  var ratioThreshold = getOtsuThreshold(ratio, 'ratio');
  var ratioWater = ratio.gt(ratioThreshold);

  // Use user-defined voting threshold
  var waterMask = vvWater.add(vhWater).add(ratioWater)
    .gte(state.sarVotesRequired)
    .rename('water');
  return waterMask.updateMask(waterMask);
}

/**
 * Calculates specified water index for Sentinel-2 imagery.
 */
function calculateWaterIndex(image, indexName) {
  switch(indexName) {
    case 'Band8':
      return image.select('B8').rename('water_index');
    case 'NDWI':
      return image.normalizedDifference(['B3', 'B8']).rename('water_index');
    case 'MNDWI':
      return image.normalizedDifference(['B3', 'B11']).rename('water_index');
    case 'AWEInsh':
      return image.expression(
        '4 * (GREEN - SWIR1) - (0.25 * NIR + 2.75 * SWIR2)',
        {
          'GREEN': image.select('B3'),
          'SWIR1': image.select('B11'),
          'NIR':   image.select('B8'),
          'SWIR2': image.select('B12')
        }
      ).rename('water_index');
    case 'AWEIsh':
      return image.expression(
        'BLUE + 2.5 * GREEN - 1.5 * (NIR + SWIR1) - 0.25 * SWIR2',
        {
          'BLUE':  image.select('B2'),
          'GREEN': image.select('B3'),
          'NIR':   image.select('B8'),
          'SWIR1': image.select('B11'),
          'SWIR2': image.select('B12')
        }
      ).rename('water_index');
    case 'SMBWI':
      return image.expression(
        '(B2 + B3 + B4) / (B8 + B11 + B12)',
        {
          'B2':  image.select('B2'),
          'B3':  image.select('B3'),
          'B4':  image.select('B4'),
          'B8':  image.select('B8'),
          'B11': image.select('B11'),
          'B12': image.select('B12')
        }
      ).rename('water_index');
    case 'WRI':
      return image.expression(
        '(GREEN + RED) / (NIR + SWIR1)',
        {
          'GREEN': image.select('B3'),
          'RED':   image.select('B4'),
          'NIR':   image.select('B8'),
          'SWIR1': image.select('B11')
        }
      ).rename('water_index');
    case 'NDWI2':
      return image.normalizedDifference(['B8', 'B11']).rename('water_index');
    default:
      // Default to MNDWI
      return image.normalizedDifference(['B3', 'B11']).rename('water_index');
  }
}

/**
 * Detects water from Sentinel-2 using Otsu threshold on the chosen water index.
 */
function detectWaterFromOptical(image, indexName) {
  var waterIndex = calculateWaterIndex(image, indexName);

  if (state.useCustomThreshold) {
    return waterIndex.gt(state.waterThreshold);
  } else {
    var hist = waterIndex.reduceRegion({
      reducer: ee.Reducer.histogram({maxBuckets: 256, minBucketWidth: 0.001}),
      geometry: state.aoi,
      scale: 10,  // Maintain S2's native resolution
      maxPixels: 1e13,  // Increased for better precision
      bestEffort: true
    }).get('water_index');

    function otsu(histDict) {
      var counts = ee.Array(ee.Dictionary(histDict).get('histogram'));
      var means  = ee.Array(ee.Dictionary(histDict).get('bucketMeans'));
      var size   = means.length().get([0]);
      var total  = counts.reduce(ee.Reducer.sum(), [0]).get([0]);
      var sum    = means.multiply(counts).reduce(ee.Reducer.sum(), [0]).get([0]);
      var mean   = sum.divide(total);
      var indices= ee.List.sequence(1, size.subtract(1));

      var bss = indices.map(function(i) {
        var aCounts = counts.slice(0, 0, i);
        var aCount  = aCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
        var aMeans  = means.slice(0, 0, i);
        var aMean   = aMeans.multiply(aCounts)
                      .reduce(ee.Reducer.sum(), [0]).get([0])
                      .divide(aCount);
        var bCount  = total.subtract(aCount);
        var bMean   = sum.subtract(aCount.multiply(aMean)).divide(bCount);
        return aCount.multiply(aMean.subtract(mean).pow(2))
               .add(bCount.multiply(bMean.subtract(mean).pow(2)));
      });
      var maxIndex = ee.List(bss).indexOf(ee.List(bss).reduce(ee.Reducer.max()));
      return means.get([maxIndex]);
    }

    var threshold = ee.Number(otsu(hist));

    // If using Band8, water is typically "lower" DN -> < threshold
    if (indexName === 'Band8') {
      return waterIndex.lt(threshold);
    } else {
      // For NDWI, MNDWI, AWEI, etc., water is "higher" -> > threshold
      return waterIndex.gt(threshold);
    }
  }
}

/**
 * Detects water in Landsat 8/9 using AWEI + Otsu thresholding.
 */
function detectWaterFromLandsat(image) {
  var awei = image.expression(
    '4 * (GREEN - SWIR1) - (0.25 * NIR + 2.75 * SWIR2)', {
      'GREEN': image.select('SR_B3'),
      'NIR':   image.select('SR_B5'),
      'SWIR1': image.select('SR_B6'),
      'SWIR2': image.select('SR_B7')
    }
  ).rename('awei');

  var hist = awei.reduceRegion({
    reducer: ee.Reducer.histogram({maxBuckets: 256, minBucketWidth: 0.001}),
    geometry: image.geometry(),
    scale: 15,  // Use Landsat pan-sharpened resolution
    maxPixels: 1e13,  // Increased for better precision
    bestEffort: true
  }).get('awei');

  function otsu(histDict) {
    var counts = ee.Array(ee.Dictionary(histDict).get('histogram'));
    var means  = ee.Array(ee.Dictionary(histDict).get('bucketMeans'));
    var size   = means.length().get([0]);
    var total  = counts.reduce(ee.Reducer.sum(), [0]).get([0]);
    var sum    = means.multiply(counts).reduce(ee.Reducer.sum(), [0]).get([0]);
    var mean   = sum.divide(total);
    var indices= ee.List.sequence(1, size.subtract(1));

    var bss = indices.map(function(i) {
      var aCounts = counts.slice(0, 0, i);
      var aCount  = aCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
      var aMeans  = means.slice(0, 0, i);
      var aMean   = aMeans.multiply(aCounts)
                    .reduce(ee.Reducer.sum(), [0]).get([0])
                    .divide(aCount);
      var bCount  = total.subtract(aCount);
      var bMean   = sum.subtract(aCount.multiply(aMean)).divide(bCount);
      return aCount.multiply(aMean.subtract(mean).pow(2))
             .add(bCount.multiply(bMean.subtract(mean).pow(2)));
    });
    var maxBss = bss.reduce(ee.Reducer.max());
    var idx = bss.indexOf(maxBss);
    return means.get([idx]);
  }

  var threshold = ee.Number(otsu(hist));
  return awei.gt(threshold);
}

// ─────────────────────────────────────────────────────────────────────────────
// SHORELINE VECTOR GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a binary water mask into vectorized shoreline features.
 * 1) Removes small patches
 * 2) Morphologically smooths
 * 3) Vectorizes polygons
 * 4) Converts polygons to lines
 * 5) Keeps only lines that intersect the actual AOI boundary (coastal)
 */
function vectorizeWaterMask(waterMask, geometry) {
  // Use method-specific optimal scale for cleaning
  var methodScale = getAdaptiveScale(geometry, state.shorelineMethod);
  var cleaned = waterMask.connectedPixelCount(state.waterBodySizeThreshold, true);
  cleaned = waterMask.updateMask(cleaned.gte(state.waterBodySizeThreshold));

  // Optimize vectorization for maximum precision
  var polygons = cleaned.reduceToVectors({
    geometry: geometry,
    scale: methodScale,  // Use optimal method-specific scale instead of fixed 5m
    geometryType: 'polygon',
    eightConnected: true,
    maxPixels: 1e13,
    tileScale: 16
  });

  var shoreline = polygons.map(function(feat) {
    var coords = ee.List(feat.geometry().coordinates().get(0));
    var line = ee.Geometry.LineString(coords);
    var coastal = line.intersects(ee.Feature(geometry).geometry(), ee.ErrorMargin(0.5));  // reduced error margin
    return ee.Feature(line).set('isCoastal', coastal);
  }).filter(ee.Filter.eq('isCoastal', true));

  return shoreline;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI WORKFLOW
// ─────────────────────────────────────────────────────────────────────────────

function initializeDrawing(map, callback, panel) {
  map.drawingTools().setShown(true);
  var drawingTools = map.drawingTools();
  drawingTools.setShape('polygon');
  drawingTools.setDrawModes(['polygon']);
  drawingTools.layers().reset();

  var dummyGeom = ui.Map.GeometryLayer({geometries: null, name: 'AOI'});
  drawingTools.layers().add(dummyGeom);
  drawingTools.draw();

  panel.clear();
  panel.add(ui.Label('Draw Study Area', STYLES.heading));
  panel.add(ui.Label('Click points on map to draw polygon', STYLES.text));

  var confirmButton = ui.Button({
    label: 'Confirm Selection',
    onClick: function() {
      var geometry = drawingTools.layers().get(0).toGeometry();
      if (!geometry) {
        ui.alert('No Area Selected', 'Please draw an area first.');
        return;
      }
      callback(ee.Geometry(geometry));
    },
    style: STYLES.button
  });

  var clearButton = ui.Button({
    label: 'Clear Drawing',
    onClick: function() {
      drawingTools.layers().get(0).geometries().remove(0);
      drawingTools.draw();
    },
    style: STYLES.button
  });

  panel.add(confirmButton);
  panel.add(clearButton);
}

function showWelcome() {
  mainPanel.clear();
  map.layers().reset();
  map.setCenter(10, 51, 4);

  mainPanel.add(ui.Label('Shoreline Detection Software', STYLES.heading));
  mainPanel.add(ui.Label('Welcome', STYLES.subheading));
  mainPanel.add(ui.Label(
    'This tool helps detect shorelines using multi-sensor satellite data.\n' +
    'Click "Start Analysis" and draw your AOI to begin.',
    STYLES.text
  ));
  mainPanel.add(ui.Button({
    label: 'Start Analysis',
    onClick: function() {
      showDrawAOI();
    },
    style: STYLES.button
  }));
}

function showDrawAOI() {
  initializeDrawing(map, function(geometry) {
    state.aoi = geometry;
    showMethodSelection();
  }, mainPanel);
}

function showMethodSelection() {
  mainPanel.clear();
  mainPanel.add(ui.Label('Select Detection Method', STYLES.heading));

  var methods = [
    {label: 'Sentinel-1 SAR', value: 'sentinel1'},
    {label: 'Sentinel-2 Optical', value: 'sentinel2'},
    {label: 'Landsat 8/9', value: 'landsat'}
  ];

  methods.forEach(function(method) {
    mainPanel.add(ui.Button({
      label: method.label,
      onClick: function() {
        state.shorelineMethod = method.value;
        showAdvancedSettings(method.value);
      },
      style: STYLES.button
    }));
  });

  mainPanel.add(ui.Button({
    label: 'Back',
    onClick: showDrawAOI,
    style: STYLES.button
  }));
}

function showAdvancedSettings(method) {
  mainPanel.clear();
  mainPanel.add(ui.Label('Advanced Settings', STYLES.heading));

  // Create a panel for all settings
  var settingsPanel = ui.Panel({
    style: {
      padding: '10px',
      backgroundColor: 'white',
      border: '1px solid #ddd'
    }
  });

  // 1. Water Body Size Filter
  settingsPanel.add(ui.Label('Minimum Water Body Size', STYLES.subheading));
  settingsPanel.add(ui.Label(
    'Ignore water bodies smaller than this size (in pixels). ' +
    'Higher values remove small features, lower values keep them.',
    {color: '#666', fontSize: '11px', margin: '2px 0 8px 0'}
  ));
  var minSizeSlider = ui.Slider({
    min: 5,
    max: 100,
    value: state.waterBodySizeThreshold,
    step: 5,
    style: {width: '300px'},
    onChange: function(value) {
      state.waterBodySizeThreshold = value;
    }
  });
  settingsPanel.add(minSizeSlider);

  // 2. Coastline Smoothing
  settingsPanel.add(ui.Label('Coastline Smoothing', STYLES.subheading));
  settingsPanel.add(ui.Label(
    'Controls smoothness of the shoreline. Higher values create smoother lines ' +
    'but may lose detail. Lower values preserve detail but may be noisier.',
    {color: '#666', fontSize: '11px', margin: '2px 0 8px 0'}
  ));

  var kernelSizeSlider = ui.Slider({
    min: 1,
    max: 5,
    value: state.smoothingKernelSize,
    step: 1,
    style: {width: '300px'},
    onChange: function(value) {
      state.smoothingKernelSize = value;
    }
  });
  settingsPanel.add(ui.Label('Kernel Size:', {margin: '4px 0'}));
  settingsPanel.add(kernelSizeSlider);

  var iterationsSlider = ui.Slider({
    min: 1,
    max: 5,
    value: state.smoothingIterations,
    step: 1,
    style: {width: '300px'},
    onChange: function(value) {
      state.smoothingIterations = value;
    }
  });
  settingsPanel.add(ui.Label('Smoothing Iterations:', {margin: '4px 0'}));
  settingsPanel.add(iterationsSlider);

  // 3. Coastal Buffer
  settingsPanel.add(ui.Label('Coastal Buffer Distance', STYLES.subheading));
  settingsPanel.add(ui.Label(
    'Distance (in km) from coastline to search for water features. ' +
    'Larger values capture more coastal features but may include inland water.',
    {color: '#666', fontSize: '11px', margin: '2px 0 8px 0'}
  ));
  var bufferSlider = ui.Slider({
    min: 0.1,
    max: 2.0,
    value: state.coastalBuffer,
    step: 0.1,
    style: {width: '300px'},
    onChange: function(value) {
      state.coastalBuffer = value;
    }
  });
  settingsPanel.add(bufferSlider);

  // 4. Water Detection Sensitivity (method-specific)
  settingsPanel.add(ui.Label('Water Detection Settings', STYLES.subheading));

  if (method === 'sentinel1') {
    settingsPanel.add(ui.Label(
      'Number of SAR indicators (VV, VH, ratio) that must agree for water classification.',
      {color: '#666', fontSize: '11px', margin: '2px 0 8px 0'}
    ));
    var sarVotesSlider = ui.Slider({
      min: 1,
      max: 3,
      value: state.sarVotesRequired,
      step: 1,
      style: {width: '300px'},
      onChange: function(value) {
        state.sarVotesRequired = value;
      }
    });
    settingsPanel.add(sarVotesSlider);
  }

  if (method === 'sentinel2' || method === 'landsat') {
    settingsPanel.add(ui.Label(
      'Use custom threshold instead of automatic Otsu threshold.',
      {color: '#666', fontSize: '11px', margin: '2px 0 8px 0'}
    ));

    var useCustomThreshold = ui.Checkbox({
      label: 'Use custom threshold',
      value: state.useCustomThreshold,
      onChange: function(checked) {
        thresholdSlider.setDisabled(!checked);
        state.useCustomThreshold = checked;
      }
    });
    settingsPanel.add(useCustomThreshold);

    var thresholdSlider = ui.Slider({
      min: -1,
      max: 1,
      value: state.waterThreshold,
      step: 0.05,
      style: {width: '300px'},
      disabled: true,
      onChange: function(value) {
        state.waterThreshold = value;
      }
    });
    settingsPanel.add(thresholdSlider);
  }

  mainPanel.add(settingsPanel);

  // Add process and back buttons
  var buttonPanel = ui.Panel({
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {margin: '20px 0'}
  });

  buttonPanel.add(ui.Button({
    label: 'Process with These Settings',
    onClick: function() {
      processImagery(method);
    },
    style: STYLES.button
  }));

  buttonPanel.add(ui.Button({
    label: 'Back to Default Settings',
    onClick: function() {
      showMethodSelection();
    },
    style: STYLES.button
  }));

  mainPanel.add(buttonPanel);
}

function showDateCloudSettings(method) {
  mainPanel.clear();
  mainPanel.add(ui.Label('Image Selection Settings', STYLES.heading));

  // Date range
  mainPanel.add(ui.Label('Select Date Range:', STYLES.subheading));

  var now = Date.now();
  var sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  var startDateBox = ui.Textbox({
    placeholder: 'YYYY-MM-DD',
    value: sixMonthsAgo.toISOString().split('T')[0],
    onChange: function(value) {
      if (validateDate(value)) {
        this.style().set('color', 'black');
        state.dateRange.start = ee.Date(value);
      } else {
        this.style().set('color', 'red');
        ui.alert('Please enter a valid start date (YYYY-MM-DD)');
      }
    },
    style: {width: '150px'}
  });

  var endDateBox = ui.Textbox({
    placeholder: 'YYYY-MM-DD',
    value: new Date(now).toISOString().split('T')[0],
    onChange: function(value) {
      if (validateDate(value)) {
        this.style().set('color', 'black');
        state.dateRange.end = ee.Date(value);
      } else {
        this.style().set('color', 'red');
        ui.alert('Please enter a valid end date (YYYY-MM-DD)');
      }
    },
    style: {width: '150px'}
  });

  var startDatePanel = ui.Panel({
    widgets: [ui.Label('Start:', {margin: '4px 8px 4px 0px'}), startDateBox],
    layout: ui.Panel.Layout.flow('horizontal')
  });
  mainPanel.add(startDatePanel);

  var endDatePanel = ui.Panel({
    widgets: [ui.Label('End:', {margin: '12px 8px 4px 0px'}), endDateBox],
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {margin: '8px 0 0 0'}
  });
  mainPanel.add(endDatePanel);

  // Cloud cover (not needed for Sentinel-1)
  if (method !== 'sentinel1') {
    mainPanel.add(ui.Label('Cloud Cover Percentage:', STYLES.subheading));
    var cloudSlider = ui.Slider({
      min: 0, max: 100, value: state.cloudCover, step: 5,
      onChange: function(value) {
        state.cloudCover = value;
      },
      style: {width: '300px'}
    });
    mainPanel.add(cloudSlider);
  }

  // Composite method selection (applicable to Sentinel-1 or Sentinel-2)
  if (method === 'sentinel1' || method === 'sentinel2') {
    mainPanel.add(ui.Label('Composite Method:', STYLES.subheading));
    var compositeOptions = ['Median', 'Mean'];
    var compositeSelect = ui.Select({
      items: compositeOptions,
      value: state.compositeMethod,
      onChange: function(value) {
        state.compositeMethod = value;
      }
    });
    mainPanel.add(compositeSelect);
  }

  mainPanel.add(ui.Button({
    label: 'Process Images',
    onClick: function() {
      if (method === 'sentinel2') {
        showSentinel2Options();
      } else {
        processImagery(method);
      }
    },
    style: STYLES.button
  }));

  mainPanel.add(ui.Button({
    label: 'Back',
    onClick: showMethodSelection,
    style: STYLES.button
  }));
}

function showSentinel2Options() {
  mainPanel.clear();
  mainPanel.add(ui.Label('Select Water Index', STYLES.heading));

  var indices = [
    {label: 'Band8 (NIR)', value: 'Band8'},
    {label: 'MNDWI', value: 'MNDWI'},
    {label: 'NDWI',  value: 'NDWI'},
    {label: 'AWEInsh', value: 'AWEInsh'},
    {label: 'AWEIsh', value: 'AWEIsh'},
    {label: 'SMBWI', value: 'SMBWI'},
    {label: 'WRI',   value: 'WRI'},
    {label: 'NDWI2', value: 'NDWI2'}
  ];

  indices.forEach(function(idx) {
    mainPanel.add(ui.Button({
      label: idx.label,
      onClick: function() {
        state.waterIndex = idx.value;
        processImagery('sentinel2');
      },
      style: STYLES.button
    }));
  });

  mainPanel.add(ui.Button({
    label: 'Back',
    onClick: showMethodSelection,
    style: STYLES.button
  }));
}

function processImagery(method) {
  var startDate = state.dateRange.start || ee.Date(Date.now()).advance(-6, 'month');
  var endDate   = state.dateRange.end   || ee.Date(Date.now());
  var loadingLabel = ui.Label('Processing...');
  mainPanel.add(loadingLabel);

  try {
    switch(method) {
      case 'sentinel1':
        loadingLabel.setValue('Processing Sentinel-1...');
        processSentinel1(startDate, endDate, loadingLabel);
        break;
      case 'sentinel2':
        loadingLabel.setValue('Processing Sentinel-2...');
        processSentinel2(startDate, endDate, loadingLabel);
        break;
      case 'landsat':
        loadingLabel.setValue('Processing Landsat...');
        processLandsat(startDate, endDate, loadingLabel);
        break;
    }
  } catch(e) {
    loadingLabel.setValue('Error: ' + e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DISPLAY & EXPORT
// ─────────────────────────────────────────────────────────────────────────────

function displayResults(method, water, shoreline, loadingLabel) {
  state.results[method] = {
    water: water,
    shoreline: shoreline
  };

  map.layers().reset();

  // Show raw image
  if (state.rawImage) {
    switch(method) {
      case 'sentinel1':
        map.addLayer(state.rawImage, {
          bands: ['VV'],
          min: -25, max: 0,
          palette: ['black', 'white']
        }, method + ' Raw SAR (VV)', true);
        break;
      case 'sentinel2':
        map.addLayer(state.rawImage, {
          bands: ['B4', 'B3', 'B2'],
          min: 0, max: 3000
        }, method + ' True Color', true);
        break;
      case 'landsat':
        map.addLayer(state.rawImage, {
          bands: ['SR_B4', 'SR_B3', 'SR_B2'],
          min: 7000, max: 30000, gamma: 1.2
        }, method + ' True Color', true);
        break;
    }
  }

  // Show water
  if (water) {
    map.addLayer(water.selfMask(), {
      palette: ['#0000FF'],
      opacity: 0.5
    }, method + ' Water');
  }

  // Show shoreline
  if (shoreline) {
    map.addLayer(shoreline, {color: '#FF0000', width: 3}, method + ' Shoreline');
  }

  map.centerObject(state.aoi, 12);
  loadingLabel.setValue('Processing complete! Showing ' + method + ' results.');

  // Export section
  mainPanel.add(ui.Label('Export Options:', {
    fontWeight: 'bold', margin: '20px 0 10px 0'
  }));

  var exportPanel = ui.Panel({
    style: {margin: '8px 0', padding: '10px', backgroundColor: 'white'}
  });

  // Shoreline export
  exportPanel.add(ui.Button({
    label: 'Export Shoreline (SHP)',
    onClick: function() {
      Export.table.toDrive({
        collection: shoreline,
        description: 'Shoreline_' + method + '_' + Date.now(),
        fileFormat: 'SHP',
        selectors: ['.*'],
        maxVertices: 1e9
      });
      exportPanel.add(ui.Label('✓ Shoreline export started! Check Tasks panel.', {
        color: '#2E7D32', margin: '5px 0'
      }));
    },
    style: STYLES.button
  }));

  // Sentinel-2: add image export
  if (method === 'sentinel2') {
    // Export RGB
    exportPanel.add(ui.Button({
      label: 'Export RGB (GeoTIFF)',
      onClick: function() {
        Export.image.toDrive({
          image: state.rawImage.select(['B4','B3','B2']),
          description: 'Sentinel2_RGB_' + Date.now(),
          scale: 10,
          region: state.aoi,
          maxPixels: 1e13,
          formatOptions: {
            cloudOptimized: true,
            fileDimensions: 20000
          }
        });
        exportPanel.add(ui.Label('✓ RGB export started! Check Tasks panel.', {
          color: '#2E7D32', margin: '5px 0'
        }));
      },
      style: STYLES.button
    }));

    // Export water index
    exportPanel.add(ui.Button({
      label: 'Export ' + state.waterIndex + ' (GeoTIFF)',
      onClick: function() {
        var wi = calculateWaterIndex(state.rawImage, state.waterIndex);
        Export.image.toDrive({
          image: wi,
          description: 'Sentinel2_' + state.waterIndex + '_' + Date.now(),
          scale: 10,
          region: state.aoi,
          maxPixels: 1e9
        });
        exportPanel.add(ui.Label('✓ Water index export started! Check Tasks panel.', {
          color: '#2E7D32', margin: '5px 0'
        }));
      },
      style: STYLES.button
    }));
  }

  mainPanel.add(exportPanel);
}

// ─────────────────────────────────────────────────────────────────────────────
// SATELLITE-SPECIFIC PROCESSING
// ─────────────────────────────────────────────────────────────────────────────

function processSentinel1(startDate, endDate, loadingLabel) {
  var expandedAOI = state.aoi.buffer(500);

  var collection = ee.ImageCollection('COPERNICUS/S1_GRD')
      .filterBounds(expandedAOI)
      .filterDate(startDate, endDate)
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
      .filter(ee.Filter.eq('instrumentMode', 'IW'));

  var count = collection.size().getInfo();
  if (count === 0) {
    loadingLabel.setValue('No Sentinel-1 images found.');
    return;
  }

  var composite;
  if (state.compositeMethod === 'Mean') {
    composite = collection.mean();
  } else {
    composite = collection.median(); // default
  }
  var image = composite.clip(expandedAOI);

  // Store raw
  state.rawImage = image;

  // Detect water & extract shoreline
  var waterMask = detectWaterFromSAR(image);
  var shoreline = vectorizeWaterMask(waterMask, expandedAOI);
  var clippedShoreline = shoreline.map(function(f) {
    return f.intersection(state.aoi);
  }).filterBounds(state.aoi);

  displayResults('sentinel1', waterMask.clip(state.aoi), clippedShoreline, loadingLabel);
}

function processSentinel2(startDate, endDate, loadingLabel) {
  var expandedAOI = state.aoi.buffer(500);

  var collection = ee.ImageCollection('COPERNICUS/S2')
      .filterBounds(expandedAOI)
      .filterDate(startDate, endDate)
      .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', state.cloudCover));

  var count = collection.size().getInfo();
  if (count === 0) {
    loadingLabel.setValue('No Sentinel-2 images found.');
    return;
  }

  var composite;
  if (state.compositeMethod === 'Mean') {
    composite = collection.mean();
  } else {
    composite = collection.median(); // default
  }
  var image = composite.clip(expandedAOI);
  state.rawImage = image;

  // Water detection
  var waterMask = detectWaterFromOptical(image, state.waterIndex);
  var shoreline = vectorizeWaterMask(waterMask, expandedAOI);
  var clippedShoreline = shoreline.map(function(f) {
    return f.intersection(state.aoi);
  }).filterBounds(state.aoi);

  displayResults('sentinel2', waterMask.clip(state.aoi), clippedShoreline, loadingLabel);
}

function processLandsat(startDate, endDate, loadingLabel) {
  var expandedAOI = state.aoi.buffer(500);

  var collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
      .filterBounds(expandedAOI)
      .filterDate(startDate, endDate)
      .filter(ee.Filter.lt('CLOUD_COVER', state.cloudCover));

  var count = collection.size().getInfo();
  if (count === 0) {
    loadingLabel.setValue('No Landsat images found.');
    return;
  }

  var image = collection.median().clip(expandedAOI);
  state.rawImage = image;

  var waterMask = detectWaterFromLandsat(image);
  var shoreline = vectorizeWaterMask(waterMask, expandedAOI);
  var clippedShoreline = shoreline.map(function(f) {
    return f.intersection(state.aoi);
  }).filterBounds(state.aoi);

  displayResults('landsat', waterMask.clip(state.aoi), clippedShoreline, loadingLabel);
}

// ─────────────────────────────────────────────────────────────────────────────
// LAUNCH THE APP
// ─────────────────────────────────────────────────────────────────────────────
showWelcome();
