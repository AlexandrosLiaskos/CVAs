/*********************************
 * Shoreline Detection Software
 * @version 1.1.0
 *********************************/

// ─────────────────────────────────────────────────────────────────────────────
// STYLES AND GLOBALS
// ─────────────────────────────────────────────────────────────────────────────
var STYLES = {
    heading:    {fontSize: '24px', fontWeight: 'bold', margin: '10px 0'},
    subheading: {fontSize: '16px', fontWeight: 'bold', margin: '8px 0'},
    text:       {fontSize: '14px', margin: '5px 0'},
    button:     {margin: '5px 0', backgroundColor: 'white'}
  };

  // Icons for UI elements
  var ICONS = {
    info: 'ⓘ',
    sentinel1: '📡',  // Radar
    sentinel2: '🔭',  // Optical
    landsat: '🛰️',    // Satellite
    settings: '⚙️',   // Gear
    calendar: '📅',   // Calendar
    export: '💾',     // Save
    results: '📊',    // Chart
    help: '❓',       // Question mark
    back: '⬅️',       // Back arrow
    next: '➡️',       // Next arrow
    download: '⬇️',   // Download arrow
    warning: '⚠️'     // Warning
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
  var mainPanel = ui.Panel({style: {width: '340px', padding: '10px'}});
  var resultsPanel = ui.Panel({style: {width: '340px', padding: '10px', shown: false}});
  var map = ui.Map();
  map.style().set('cursor', 'crosshair');
  map.setControlVisibility({drawingTools: false});
  ui.root.clear();

  // Create a panel to hold both mainPanel and resultsPanel
  var sidebarPanel = ui.Panel({
    widgets: [mainPanel, resultsPanel],
    layout: ui.Panel.Layout.flow('vertical'),
    style: {width: '360px'}
  });

  ui.root.add(ui.SplitPanel({firstPanel: map, secondPanel: sidebarPanel}));

  // Create a help panel that can be toggled
  var helpPanel = ui.Panel({
    style: {
      position: 'bottom-right',
      width: '300px',
      height: '200px',
      padding: '10px',
      backgroundColor: 'rgba(255, 255, 255, 0.9)',
      shown: false
    }
  });
  map.add(helpPanel);

  // Add a footer panel for status updates
  var statusPanel = ui.Panel({
    widgets: [ui.Label('Ready')],
    style: {
      position: 'bottom-left',
      padding: '5px',
      backgroundColor: 'rgba(255, 255, 255, 0.7)'
    }
  });
  map.add(statusPanel);

  function updateStatus(message, isError) {
    statusPanel.clear();
    statusPanel.add(ui.Label({
      value: message,
      style: {
        color: isError ? 'red' : 'black',
        fontSize: '13px'
      }
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HELPER FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Creates a panel with an information icon and tooltip
   * @param {string} infoText - Text to display in the tooltip
   * @returns {ui.Panel} Panel with info icon
   */
  function createInfoTooltip(infoText) {
    var infoIcon = ui.Label({
      value: ICONS.info,
      style: {
        padding: '0 3px',
        margin: '0 0 0 5px',
        color: '#2196F3'
      }
    });

    // Use a standard button with click handler instead
    var infoButton = ui.Button({
      label: ICONS.info,
      onClick: function() {
        helpPanel.clear();

        // Toggle the help panel visibility
        var isShown = helpPanel.style().get('shown');
        helpPanel.style().set('shown', !isShown);

        if (!isShown) {
          helpPanel.add(ui.Label({
            value: infoText,
            style: {fontSize: '13px', padding: '5px'}
          }));

          // Add a close button
          helpPanel.add(ui.Button({
            label: 'Close',
            onClick: function() {
              helpPanel.style().set('shown', false);
            },
            style: STYLES.button
          }));
        }
      },
      style: {
        padding: '0 3px',
        margin: '0 0 0 5px'
      }
    });

    return ui.Panel({
      widgets: [infoButton],
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {padding: '0', margin: '0'}
    });
  }

  /**
   * Creates a section header with optional info tooltip
   * @param {string} title - Section title
   * @param {string} info - Optional tooltip text
   * @returns {ui.Panel} Panel with title and optional info
   */
  function createSectionHeader(title, info) {
    var header = ui.Label(title, STYLES.subheading);

    if (!info) {
      return header;
    }

    var panel = ui.Panel({
      widgets: [header, createInfoTooltip(info)],
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {padding: '0', margin: '5px 0'}
    });

    return panel;
  }

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
   * Automatically adjusts resolution based on area size to prevent computation errors
   */
  function getAdaptiveScale(geometry, method) {
    // Calculate area in square kilometers
    var area = geometry.area().divide(1000 * 1000);

    // Get base resolution for method
    var baseScale;
    switch(method) {
      case 'sentinel2':
        baseScale = 10;
      case 'sentinel1':
        baseScale = 10;
      case 'landsat':
        baseScale = 15;
      default:
        baseScale = 10;
    }

    // Adjust scale based on area size
    return ee.Number(area).gt(1000)  // If area > 1000 km²
      .multiply(30)                   // Use 30m resolution
      .add(                          // Otherwise
        ee.Number(area).gt(100)      // If area > 100 km²
        .multiply(20)                // Use 20m resolution
        .add(baseScale)              // Otherwise use base resolution
      );
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
        var maxBss = bss.reduce(ee.Reducer.max());
        var idx = bss.indexOf(maxBss);
        return means.get([idx]);
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
   */
  function vectorizeWaterMask(waterMask, geometry) {
    // Calculate appropriate scale based on area
    var scale = getAdaptiveScale(geometry, 'sentinel2');

    // Use a larger tile size for faster processing
    var tileSize = 0.2;  // 0.2 degrees

    try {
      // Clean up the water mask first - this reduces memory usage
      // Use simpler focal operations for better compatibility
      var cleaned = waterMask
        .updateMask(waterMask.connectedPixelCount(state.waterBodySizeThreshold, true)
        .gte(state.waterBodySizeThreshold))
        .focal_max(state.smoothingKernelSize)
        .focal_min(state.smoothingKernelSize);

      // Create boundary for coastal filtering with simplified buffer operations
      var aoiBoundary = ee.Feature(geometry).geometry()
        .buffer(state.coastalBuffer * 1000)
        .difference(ee.Feature(geometry).geometry().buffer(-state.coastalBuffer * 1000));

      // Break into smaller tiles for processing
      var bounds = geometry.bounds();
      var coords = ee.List(bounds.coordinates().get(0));
      var xmin = ee.Number(ee.List(coords.get(0)).get(0));
      var ymin = ee.Number(ee.List(coords.get(0)).get(1));
      var xmax = ee.Number(ee.List(coords.get(2)).get(0));
      var ymax = ee.Number(ee.List(coords.get(2)).get(1));

      // Reduce number of tiles for better performance
      var xTiles = xmax.subtract(xmin).divide(tileSize).ceil();
      var yTiles = ymax.subtract(ymin).divide(tileSize).ceil();

      // Create tiles with simplified geometry
      var tiles = ee.List.sequence(0, xTiles.subtract(1)).map(function(x) {
        return ee.List.sequence(0, yTiles.subtract(1)).map(function(y) {
          return ee.Geometry.Rectangle([
            xmin.add(ee.Number(x).multiply(tileSize)),
            ymin.add(ee.Number(y).multiply(tileSize)),
            xmin.add(ee.Number(x).add(1).multiply(tileSize)),
            ymin.add(ee.Number(y).add(1).multiply(tileSize))
          ]);
        });
      }).flatten();

      // Process tiles with minimal parameters
      var vectors = ee.FeatureCollection(tiles.map(function(tile) {
        return cleaned.reduceToVectors({
          geometry: ee.Geometry(tile),
          scale: scale,
          geometryType: 'polygon',
          eightConnected: false,
          maxPixels: 1e8,
          tileScale: 2  // Reduced for better performance
        });
      })).flatten();

      // Filter and convert to shoreline with minimal operations
      return vectors
        .filter(ee.Filter.gt('area', 1e4))
        .map(function(feat) {
          var coords = ee.List(feat.geometry().coordinates().get(0));
          var line = ee.Geometry.LineString(coords);
          var coastal = line.intersects(aoiBoundary, ee.ErrorMargin(2));  // Increased error margin
          return ee.Feature(line).set('isCoastal', coastal);
        })
        .filter(ee.Filter.eq('isCoastal', true));

    } catch (e) {
      console.error('Error in vectorization:', e);
      updateStatus('Error during vectorization: ' + e.message, true);
      return null;
    }
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

    // Add drawing instructions with icon
    var instructionsPanel = ui.Panel({
      widgets: [
        ui.Label(ICONS.info + ' Instructions:', {fontWeight: 'bold', margin: '4px 0'}),
        ui.Label('1. Click points on map to draw your area of interest', {margin: '2px 0'}),
        ui.Label('2. Complete the polygon by clicking on the first point', {margin: '2px 0'}),
        ui.Label('3. Click "Confirm Selection" when finished', {margin: '2px 0'})
      ],
      style: {
        padding: '8px',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        margin: '5px 0'
      }
    });
    panel.add(instructionsPanel);

    // Add drawing tips
    panel.add(ui.Label({
      value: ICONS.help + ' Tip: You can edit points by dragging them after drawing',
      style: {fontSize: '12px', color: '#666', margin: '5px 0'}
    }));

    var confirmButton = ui.Button({
      label: 'Confirm Selection',
      onClick: function() {
        var geometry = drawingTools.layers().get(0).toGeometry();
        if (!geometry) {
          ui.alert('No Area Selected', 'Please draw an area first.');
          updateStatus('No area selected. Please draw an area on the map.', true);
          return;
        }
        updateStatus('Area selected successfully');
        callback(ee.Geometry(geometry));
      },
      style: STYLES.button
    });

    var clearButton = ui.Button({
      label: 'Clear Drawing',
      onClick: function() {
        drawingTools.layers().get(0).geometries().remove(0);
        drawingTools.draw();
        updateStatus('Drawing cleared. Please draw a new area.');
      },
      style: STYLES.button
    });

    var buttonPanel = ui.Panel({
      widgets: [confirmButton, clearButton],
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {margin: '10px 0'}
    });
    panel.add(buttonPanel);
  }

  function showWelcome() {
    resultsPanel.style().set('shown', false);
    mainPanel.clear();
    map.layers().reset();
    map.setCenter(10, 51, 4);

    // App title with version - Fixed to use proper GEE styling properties
    var titleLabel = ui.Label({
      value: 'Shoreline Detection Software v1.0.1',
      style: {
        fontSize: '20px',
        fontWeight: 'bold',
        margin: '10px 0',
        padding: '5px 0'
      }
    });

    // Add a separator panel instead of using borderBottom
    var titleSeparator = ui.Panel({
      style: {
        height: '2px',
        backgroundColor: '#4285F4',
        margin: '0 0 10px 0',
        stretch: 'horizontal'
      }
    });

    mainPanel.add(titleLabel);
    mainPanel.add(titleSeparator);

    // Description panel
    var descriptionPanel = ui.Panel({
      widgets: [
        ui.Label('Welcome to the Shoreline Detection Tool', STYLES.subheading),
        ui.Label({
          value: 'This application helps you detect shorelines from satellite imagery using ' +
                 'multiple data sources and advanced techniques. The tool supports:',
          style: {fontSize: '14px', margin: '5px 0'}
        }),
        ui.Label({
          value: '• Sentinel-1 SAR radar data',
          style: {fontSize: '13px', margin: '2px 0 2px 10px'}
        }),
        ui.Label({
          value: '• Sentinel-2 optical imagery',
          style: {fontSize: '13px', margin: '2px 0 2px 10px'}
        }),
        ui.Label({
          value: '• Landsat 8/9 imagery',
          style: {fontSize: '13px', margin: '2px 0 2px 10px'}
        }),
        ui.Label({
          value: 'Start by clicking the button below and drawing your area of interest.',
          style: {fontSize: '14px', margin: '10px 0 5px 0'}
        })
      ],
      style: {
        backgroundColor: 'white',
        padding: '10px',
        border: '1px solid #ddd',
        margin: '5px 0 15px 0'
      }
    });

    mainPanel.add(descriptionPanel);

    // Start button with icon
    var startButton = ui.Button({
      label: ICONS.next + ' Start Analysis',
      onClick: function() {
        updateStatus('Drawing mode activated. Please draw your area of interest.');
        showDrawAOI();
      },
      style: STYLES.button
    });
    mainPanel.add(startButton);

    // Credits and about section
    var aboutPanel = ui.Panel({
      widgets: [
        ui.Label('About', {fontWeight: 'bold', margin: '5px 0'}),
        ui.Label({
          value: 'This tool uses Earth Engine to process satellite data and ' +
                 'extract shorelines automatically. It provides multiple water detection ' +
                 'algorithms for different environments.',
          style: {fontSize: '12px', color: '#666'}
        })
      ],
      style: {
        position: 'bottom-center',
        margin: '20px 0 0 0',
        padding: '10px',
        fontSize: '11px',
        border: '1px solid #eee'
      }
    });
    mainPanel.add(aboutPanel);

    updateStatus('Ready to start shoreline detection. Click "Start Analysis"');
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
      {label: 'Landsat 8/9', value: 'landsat'},
      {label: 'Process Asset', value: 'asset'}  // Add asset option
    ];

    methods.forEach(function(method) {
      mainPanel.add(ui.Button({
        label: method.label,
        onClick: function() {
          state.shorelineMethod = method.value;
          if (method.value === 'asset') {
            addAssetSelector(mainPanel);
          } else {
            showDateCloudSettings(method.value);
          }
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
    mainPanel.add(ui.Label({
      value: ICONS.settings + ' Advanced Settings',
      style: STYLES.heading
    }));

    // Create a panel for all settings
    var settingsPanel = ui.Panel({
      style: {
        padding: '10px',
        backgroundColor: 'white',
        border: '1px solid #ddd'
      }
    });

    // 1. Water Body Size Filter
    var sizeHeader = createSectionHeader('Minimum Water Body Size',
      'Controls the minimum size of water bodies to include in the analysis. ' +
      'Higher values remove small ponds and noise, lower values keep more detail.');

    settingsPanel.add(sizeHeader);

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
    var smoothingHeader = createSectionHeader('Coastline Smoothing',
      'Controls how smooth the shoreline will appear. Higher values create smoother lines ' +
      'but may lose detail. Lower values preserve detail but may show pixelation.');

    settingsPanel.add(smoothingHeader);

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
    var bufferHeader = createSectionHeader('Coastal Buffer Distance',
      'Distance (in km) from coastline to search for water features. ' +
      'Larger values capture more coastal features but may include inland water.');

    settingsPanel.add(bufferHeader);

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
    var waterDetectionHeader = createSectionHeader('Water Detection Settings',
      method === 'sentinel1' ?
        'SAR-specific settings for water detection sensitivity' :
        'Optical imagery water detection parameters');

    settingsPanel.add(waterDetectionHeader);

    if (method === 'sentinel1') {
      settingsPanel.add(ui.Label({
        value: 'SAR Votes Required (1-3):',
        style: {fontSize: '13px', margin: '4px 0'}
      }));

      var tooltipText = 'Number of SAR indicators (VV, VH, ratio) that must agree for water classification. ' +
                        'Higher is more conservative, lower detects more water but may have false positives.';

      settingsPanel.add(createInfoTooltip(tooltipText));

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
      var thresholdPanel = ui.Panel({
        layout: ui.Panel.Layout.flow('horizontal'),
        style: {margin: '4px 0'}
      });

      var useCustomThreshold = ui.Checkbox({
        label: 'Use custom threshold',
        value: state.useCustomThreshold,
        onChange: function(checked) {
          thresholdSlider.setDisabled(!checked);
          state.useCustomThreshold = checked;
        }
      });

      thresholdPanel.add(useCustomThreshold);
      thresholdPanel.add(createInfoTooltip(
        'Enable to manually set water threshold instead of using automatic Otsu thresholding. ' +
        'Useful for fine-tuning results in complex areas.'
      ));

      settingsPanel.add(thresholdPanel);

      var thresholdSlider = ui.Slider({
        min: -1,
        max: 1,
        value: state.waterThreshold,
        step: 0.05,
        style: {width: '300px'},
        disabled: !state.useCustomThreshold,
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
      label: ICONS.next + ' Continue',
      onClick: function() {
        updateStatus('Configuring date and image settings');
        showDateCloudSettings(method);
      },
      style: STYLES.button
    }));

    buttonPanel.add(ui.Button({
      label: ICONS.back + ' Back',
      onClick: function() {
        updateStatus('Returning to method selection');
        showMethodSelection();
      },
      style: STYLES.button
    }));

    mainPanel.add(buttonPanel);
  }

  function showDateCloudSettings(method) {
    mainPanel.clear();
    mainPanel.add(ui.Label('Image Selection Settings', STYLES.heading));

    // Date range panel with white background
    var dateRangePanel = ui.Panel({
      widgets: [
        ui.Label('Select the time period for image acquisition. Shorter time periods may have fewer images but better seasonal consistency.', {
          margin: '5px 0',
          fontSize: '13px'
        })
      ],
      style: {
        padding: '10px',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        margin: '5px 0 15px 0'
      }
    });
    mainPanel.add(dateRangePanel);

    // Date range inputs
    var now = Date.now();
    var oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    var startDateBox = ui.Textbox({
      placeholder: 'YYYY-MM-DD',
      value: oneMonthAgo.toISOString().split('T')[0],
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
      mainPanel.add(createSectionHeader('Cloud Cover Maximum (%)',
        'Maximum cloud cover percentage allowed in images. Lower values ensure clearer images but may reduce the number of available scenes.'));

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
      mainPanel.add(createSectionHeader('Composite Method',
        'Method used to combine multiple images. Median is better for removing outliers, while Mean can be more sensitive to gradual changes.'));

      var compositeOptions = ['Median', 'Mean'];
      var compositeSelect = ui.Select({
        items: compositeOptions,
        value: state.compositeMethod,
        onChange: function(value) {
          state.compositeMethod = value;
        },
        style: {width: '150px'}
      });
      mainPanel.add(compositeSelect);
    }

    // Add buttons
    var buttonPanel = ui.Panel({
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {margin: '20px 0'}
    });

    buttonPanel.add(ui.Button({
      label: method === 'sentinel2' ? 'Select Water Index' : 'Process Images',
      onClick: function() {
        if (method === 'sentinel2') {
          updateStatus('Selecting water index for Sentinel-2');
          showSentinel2Options();
        } else {
          updateStatus('Processing ' + method + ' imagery...');
          processImagery(method);
        }
      },
      style: STYLES.button
    }));

    buttonPanel.add(ui.Button({
      label: ICONS.back + ' Back',
      onClick: function() {
        updateStatus('Returning to advanced settings');
        showAdvancedSettings(method);
      },
      style: STYLES.button
    }));

    mainPanel.add(buttonPanel);
  }

  function showSentinel2Options() {
    mainPanel.clear();
    mainPanel.add(ui.Label('Select Water Index', STYLES.heading));

    // Information about water indices
    var infoPanel = ui.Panel({
      widgets: [
        ui.Label({
          value: 'Water indices use different band combinations to highlight water features. Choose the best index for your environment:',
          style: {fontSize: '13px', margin: '3px 0'}
        })
      ],
      style: {
        padding: '8px',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        margin: '5px 0 10px 0'
      }
    });
    mainPanel.add(infoPanel);

    var indices = [
      {
        label: 'MNDWI (Modified NDWI)',
        value: 'MNDWI',
        description: 'Best for most cases, uses green and SWIR bands. Good at suppressing built-up area noise.'
      },
      {
        label: 'NDWI (Normalized Difference Water Index)',
        value: 'NDWI',
        description: 'Uses green and NIR bands. Good for clear water bodies but may confuse with built-up areas.'
      },
      {
        label: 'AWEInsh (Automated Water Extraction Index)',
        value: 'AWEInsh',
        description: 'Non-shadow variant, good for areas without mountain shadows.'
      },
      {
        label: 'AWEIsh (AWEI shadow)',
        value: 'AWEIsh',
        description: 'Shadow variant, better for mountainous regions with shadows.'
      },
      {
        label: 'Band8 (NIR)',
        value: 'Band8',
        description: 'Simple NIR band. Water appears dark. Good for clear contrast scenes.'
      },
      {
        label: 'SMBWI (Sentinel Multi-Band Water Index)',
        value: 'SMBWI',
        description: 'Designed for Sentinel-2, uses multiple bands for robustness.'
      },
      {
        label: 'WRI (Water Ratio Index)',
        value: 'WRI',
        description: 'Ratio-based index, sometimes useful in vegetated areas.'
      },
      {
        label: 'NDWI2 (NIR-SWIR)',
        value: 'NDWI2',
        description: 'Alternative NDWI using NIR and SWIR bands. Good for turbid waters.'
      }
    ];

    // Create index cards with descriptions
    indices.forEach(function(idx) {
      var indexCard = ui.Panel({
        widgets: [
          ui.Label({
            value: idx.label,
            style: {fontWeight: 'bold', fontSize: '14px', margin: '5px 0'}
          }),
          ui.Label({
            value: idx.description,
            style: {fontSize: '12px', color: '#666', margin: '3px 0'}
          }),
          ui.Button({
            label: 'Select',
            onClick: function() {
              state.waterIndex = idx.value;
              updateStatus('Processing with ' + idx.label + '...');
              processImagery('sentinel2');
            },
            style: STYLES.button
          })
        ],
        style: {
          padding: '8px',
          backgroundColor: 'white',
          border: '1px solid #ddd',
          margin: '8px 0'
        }
      });
      mainPanel.add(indexCard);
    });

    mainPanel.add(ui.Button({
      label: ICONS.back + ' Back',
      onClick: function() {
        updateStatus('Returning to date settings');
        showDateCloudSettings('sentinel2');
      },
      style: STYLES.button
    }));
  }

  function processImagery(method) {
    var startDate = state.dateRange.start || ee.Date(Date.now()).advance(-1, 'month');
    var endDate   = state.dateRange.end   || ee.Date(Date.now());

    // Clear previous results and show loading
    resultsPanel.clear();
    mainPanel.clear();

    // Create progress panel
    var progressPanel = ui.Panel({
      widgets: [
        ui.Label({
          value: 'Processing ' + method.toUpperCase() + ' imagery...',
          style: {fontWeight: 'bold', margin: '5px 0'}
        }),
        ui.Label({
          value: 'This may take a few minutes. Please wait.',
          style: {fontSize: '13px', margin: '5px 0'}
        })
      ],
      style: {
        padding: '10px',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        margin: '10px 0'
      }
    });

    mainPanel.add(ui.Label('Processing Status', STYLES.heading));
    mainPanel.add(progressPanel);

    // Add a cancel button
    mainPanel.add(ui.Button({
      label: 'Cancel',
      onClick: function() {
        updateStatus('Processing cancelled');
        showMethodSelection();
      },
      style: STYLES.button
    }));

    try {
      updateStatus('Processing ' + method + ' imagery...');

      switch(method) {
        case 'sentinel1':
          processSentinel1(startDate, endDate, progressPanel);
          break;
        case 'sentinel2':
          processSentinel2(startDate, endDate, progressPanel);
          break;
        case 'landsat':
          processLandsat(startDate, endDate, progressPanel);
          break;
      }
    } catch(e) {
      progressPanel.clear();
      progressPanel.add(ui.Label({
        value: ICONS.warning + ' Error: ' + e.message,
        style: {color: 'red', fontWeight: 'bold'}
      }));
      updateStatus('Error during processing: ' + e.message, true);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // DISPLAY & EXPORT
  // ─────────────────────────────────────────────────────────────────────────────

  function displayResults(method, water, shoreline, progressPanel) {
    state.results[method] = {
      water: water,
      shoreline: shoreline
    };

    map.layers().reset();

    // Update progress panel
    progressPanel.clear();
    progressPanel.add(ui.Label({
      value: ICONS.results + ' Processing complete!',
      style: {color: '#2E7D32', fontWeight: 'bold', margin: '5px 0'}
    }));

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
    updateStatus('Completed processing ' + method + ' imagery');

    // Prepare the results panel
    resultsPanel.clear();
    resultsPanel.style().set('shown', true);

    // Add title to results panel - Fixed to use proper GEE styling
    var resultsTitle = ui.Label({
      value: ICONS.results + ' Results & Export',
      style: {
        fontSize: '18px',
        fontWeight: 'bold',
        margin: '10px 0 0 0',
        padding: '5px 0'
      }
    });

    // Add a separator panel instead of using borderBottom
    var resultsSeparator = ui.Panel({
      style: {
        height: '2px',
        backgroundColor: '#4285F4',
        margin: '0 0 10px 0',
        stretch: 'horizontal'
      }
    });

    resultsPanel.add(resultsTitle);
    resultsPanel.add(resultsSeparator);

    // Results summary with safe date formatting
    var summaryPanel = ui.Panel({
      widgets: [
        ui.Label('Processing Summary', {fontWeight: 'bold', margin: '5px 0'}),
        ui.Label('Method: ' + method, {fontSize: '13px', margin: '2px 0'})
      ],
      style: {
        padding: '8px',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        margin: '5px 0'
      }
    });

    // Safely add date range if available
    if (state.dateRange.start && state.dateRange.end) {
      try {
        var startDateStr = state.dateRange.start.format('YYYY-MM-DD').getInfo();
        var endDateStr = state.dateRange.end.format('YYYY-MM-DD').getInfo();
        summaryPanel.add(ui.Label('Date Range: ' + startDateStr + ' to ' + endDateStr,
          {fontSize: '13px', margin: '2px 0'}));
      } catch (e) {
        // If formatting fails, show a simpler message
        summaryPanel.add(ui.Label('Custom date range applied',
          {fontSize: '13px', margin: '2px 0'}));
      }
    } else {
      // Default message when dates aren't explicitly set
      summaryPanel.add(ui.Label('Date Range: Last month',
        {fontSize: '13px', margin: '2px 0'}));
    }

    // Add method-specific info
    if (method === 'sentinel2') {
      summaryPanel.add(ui.Label('Water Index: ' + state.waterIndex,
        {fontSize: '13px', margin: '2px 0'}));
    }

    resultsPanel.add(summaryPanel);

    // Layer visibility controls
    var layerControlPanel = ui.Panel({
      widgets: [
        ui.Label('Layer Controls', {fontWeight: 'bold', margin: '5px 0'})
      ],
      style: {
        padding: '8px',
        backgroundColor: 'white',
        border: '1px solid #ddd',
        margin: '10px 0'
      }
    });

    // Add toggles for the different layers
    var imageryCheck = ui.Checkbox({
      label: 'Satellite Imagery',
      value: true,
      onChange: function(checked) {
        var layers = map.layers();
        if (layers.length() > 0) {  // Add check
          layers.get(0).setShown(checked);
        }
      }
    });
    layerControlPanel.add(imageryCheck);

    var waterCheck = ui.Checkbox({
      label: 'Water Mask',
      value: true,
      onChange: function(checked) {
        var layers = map.layers();
        if (layers.length() > 1) {  // Add check
          layers.get(1).setShown(checked);
        }
      }
    });
    layerControlPanel.add(waterCheck);

    var shorelineCheck = ui.Checkbox({
      label: 'Shoreline',
      value: true,
      onChange: function(checked) {
        var layers = map.layers();
        if (layers.length() > 2) {  // Add check
          layers.get(2).setShown(checked);
        }
      }
    });
    layerControlPanel.add(shorelineCheck);

    resultsPanel.add(layerControlPanel);

    // Export section
    resultsPanel.add(ui.Label({
      value: ICONS.export + ' Export Options',
      style: {fontWeight: 'bold', margin: '10px 0 5px 0'}
    }));

    var exportPanel = ui.Panel({
      style: {
        margin: '8px 0',
        padding: '10px',
        backgroundColor: 'white',
        border: '1px solid #ddd'
      }
    });

    // Shoreline export
    exportPanel.add(ui.Button({
      label: ICONS.download + ' Export Shoreline (SHP)',
      onClick: function() {
        Export.table.toDrive({
          collection: shoreline,
          description: 'Shoreline_' + method + '_' + Date.now(),
          fileFormat: 'SHP',
          maxVertices: 1e9
        });
        exportPanel.add(ui.Label('✓ Shoreline export started! Check Tasks panel.', {
          color: '#2E7D32', margin: '5px 0'
        }));
      },
      style: STYLES.button
    }));

    // Water mask export
    exportPanel.add(ui.Button({
      label: ICONS.download + ' Export Water Mask (GeoTIFF)',
      onClick: function() {
        Export.image.toDrive({
          image: water,
          description: 'WaterMask_' + method + '_' + Date.now(),
          scale: getAdaptiveScale(state.aoi, method),
          region: state.aoi,
          maxPixels: 1e13
        });
        exportPanel.add(ui.Label('✓ Water mask export started! Check Tasks panel.', {
          color: '#2E7D32', margin: '5px 0'
        }));
      },
      style: STYLES.button
    }));

    // Sentinel-2: add image export
    if (method === 'sentinel2') {
      // Export RGB
      exportPanel.add(ui.Button({
        label: ICONS.download + ' Export RGB (GeoTIFF)',
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
        label: ICONS.download + ' Export ' + state.waterIndex + ' (GeoTIFF)',
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

    resultsPanel.add(exportPanel);

    // Navigation buttons
    var navPanel = ui.Panel({
      widgets: [
        ui.Button({
          label: 'New Analysis',
          onClick: function() {
            resetState();
            showWelcome();
          },
          style: STYLES.button
        }),
        ui.Button({
          label: 'Try Different Method',
          onClick: function() {
            resultsPanel.style().set('shown', false);
            showMethodSelection();
          },
          style: STYLES.button
        })
      ],
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {margin: '15px 0 5px 0'}
    });

    resultsPanel.add(navPanel);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SATELLITE-SPECIFIC PROCESSING
  // ─────────────────────────────────────────────────────────────────────────────

  function processSentinel1(startDate, endDate, progressPanel) {
    var expandedAOI = state.aoi.buffer(500);

    var collection = ee.ImageCollection('COPERNICUS/S1_GRD')
        .filterBounds(expandedAOI)
        .filterDate(startDate, endDate)
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
        .filter(ee.Filter.eq('instrumentMode', 'IW'));

    var count = collection.size().getInfo();
    if (count === 0) {
      progressPanel.clear();
      progressPanel.add(ui.Label({
        value: ICONS.warning + ' No Sentinel-1 images found for the selected period.',
        style: {color: 'red', fontWeight: 'bold'}
      }));

      progressPanel.add(ui.Button({
        label: 'Change Dates',
        onClick: function() {
          showDateCloudSettings('sentinel1');
        },
        style: STYLES.button
      }));

      updateStatus('No images found for the selected period', true);
      return;
    }

    // Update progress
    progressPanel.clear();
    progressPanel.add(ui.Label('Found ' + count + ' Sentinel-1 scenes', {margin: '5px 0'}));
    progressPanel.add(ui.Label('Creating composite...', {margin: '5px 0'}));

    updateStatus('Processing ' + count + ' Sentinel-1 scenes');

    var composite;
    if (state.compositeMethod === 'Mean') {
      composite = collection.mean();
    } else {
      composite = collection.median(); // default
    }
    var image = composite.clip(expandedAOI);

    // Store raw
    state.rawImage = image;

    // Update progress
    progressPanel.add(ui.Label('Detecting water bodies...', {margin: '5px 0'}));

    // Detect water & extract shoreline
    var waterMask = detectWaterFromSAR(image);

    progressPanel.add(ui.Label('Vectorizing shoreline...', {margin: '5px 0'}));

    var shoreline = vectorizeWaterMask(waterMask, expandedAOI);
    var clippedShoreline = shoreline.map(function(f) {
      return f.intersection(state.aoi);
    }).filterBounds(state.aoi);

    displayResults('sentinel1', waterMask.clip(state.aoi), clippedShoreline, progressPanel);
  }

  function processSentinel2(startDate, endDate, progressPanel) {
    var expandedAOI = state.aoi.buffer(500);

    var collection = ee.ImageCollection('COPERNICUS/S2')
        .filterBounds(expandedAOI)
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', state.cloudCover));

    var count = collection.size().getInfo();
    if (count === 0) {
      progressPanel.clear();
      progressPanel.add(ui.Label({
        value: ICONS.warning + ' No Sentinel-2 images found within cloud cover limit.',
        style: {color: 'red', fontWeight: 'bold'}
      }));

      progressPanel.add(ui.Button({
        label: 'Increase Cloud Cover Limit',
        onClick: function() {
          state.cloudCover = Math.min(100, state.cloudCover + 10);
          showDateCloudSettings('sentinel2');
        },
        style: STYLES.button
      }));

      progressPanel.add(ui.Button({
        label: 'Change Dates',
        onClick: function() {
          showDateCloudSettings('sentinel2');
        },
        style: STYLES.button
      }));

      updateStatus('No images found within cloud cover limit', true);
      return;
    }

    // Update progress
    progressPanel.clear();
    progressPanel.add(ui.Label('Found ' + count + ' Sentinel-2 scenes', {margin: '5px 0'}));
    progressPanel.add(ui.Label('Creating composite...', {margin: '5px 0'}));

    updateStatus('Processing ' + count + ' Sentinel-2 scenes');

    var composite;
    if (state.compositeMethod === 'Mean') {
      composite = collection.mean();
    } else {
      composite = collection.median(); // default
    }
    var image = composite.clip(expandedAOI);
    state.rawImage = image;

    // Update progress
    progressPanel.add(ui.Label('Calculating ' + state.waterIndex + '...', {margin: '5px 0'}));

    // Water detection
    var waterMask = detectWaterFromOptical(image, state.waterIndex);

    progressPanel.add(ui.Label('Vectorizing shoreline...', {margin: '5px 0'}));

    var shoreline = vectorizeWaterMask(waterMask, expandedAOI);
    var clippedShoreline = shoreline.map(function(f) {
      return f.intersection(state.aoi);
    }).filterBounds(state.aoi);

    displayResults('sentinel2', waterMask.clip(state.aoi), clippedShoreline, progressPanel);
  }

  function processLandsat(startDate, endDate, progressPanel) {
    var expandedAOI = state.aoi.buffer(500);

    var collection = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
        .filterBounds(expandedAOI)
        .filterDate(startDate, endDate)
        .filter(ee.Filter.lt('CLOUD_COVER', state.cloudCover));

    var count = collection.size().getInfo();
    if (count === 0) {
      progressPanel.clear();
      progressPanel.add(ui.Label({
        value: ICONS.warning + ' No Landsat images found within cloud cover limit.',
        style: {color: 'red', fontWeight: 'bold'}
      }));

      progressPanel.add(ui.Button({
        label: 'Increase Cloud Cover Limit',
        onClick: function() {
          state.cloudCover = Math.min(100, state.cloudCover + 10);
          showDateCloudSettings('landsat');
        },
        style: STYLES.button
      }));

      progressPanel.add(ui.Button({
        label: 'Change Dates',
        onClick: function() {
          showDateCloudSettings('landsat');
        },
        style: STYLES.button
      }));

      updateStatus('No images found within cloud cover limit', true);
      return;
    }

    // Update progress
    progressPanel.clear();
    progressPanel.add(ui.Label('Found ' + count + ' Landsat scenes', {margin: '5px 0'}));
    progressPanel.add(ui.Label('Creating composite...', {margin: '5px 0'}));

    updateStatus('Processing ' + count + ' Landsat scenes');

    var image = collection.median().clip(expandedAOI);
    state.rawImage = image;

    // Update progress
    progressPanel.add(ui.Label('Detecting water bodies...', {margin: '5px 0'}));

    var waterMask = detectWaterFromLandsat(image);

    progressPanel.add(ui.Label('Vectorizing shoreline...', {margin: '5px 0'}));

    var shoreline = vectorizeWaterMask(waterMask, expandedAOI);
    var clippedShoreline = shoreline.map(function(f) {
      return f.intersection(state.aoi);
    }).filterBounds(state.aoi);

    displayResults('landsat', waterMask.clip(state.aoi), clippedShoreline, progressPanel);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LAUNCH THE APP
  // ─────────────────────────────────────────────────────────────────────────────
  showWelcome();

  // Add local file processing capabilities
  function processLocalImage(imagePath) {
    try {
      // Update progress
      updateStatus('Processing local image: ' + imagePath);

      // Use ee.Image.load for local files
      var image = ee.Image.load(imagePath);

      // Ensure the image is properly georeferenced
      var projection = image.projection();
      var scale = projection.nominalScale();

      // Create a water mask using the loaded band
      var waterMask;
      if (imagePath.toLowerCase().includes('b08')) {
        // For Sentinel-2 Band 8 (NIR), water appears dark
        waterMask = image.lt(state.waterThreshold || 0.2);  // Default threshold 0.2 for NIR
      } else {
        // For other bands, use standard water detection
        waterMask = detectWaterFromOptical(image, state.waterIndex || 'MNDWI');
      }

      // Process the water mask
      var expandedAOI = state.aoi.buffer(500);
      var shoreline = vectorizeWaterMask(waterMask, expandedAOI);
      var clippedShoreline = shoreline.map(function(f) {
        return f.intersection(state.aoi);
      }).filterBounds(state.aoi);

      // Display results
      displayResults('local', waterMask.clip(state.aoi), clippedShoreline);

      return true;
    } catch (e) {
      console.error('Error processing local image:', e);
      updateStatus('Error processing local image: ' + e.message, true);
      return false;
    }
  }

  // Modify the main processing function to handle local files
  function processImage(source, path) {
    if (source === 'local') {
      return processLocalImage(path);
    } else {
      // Existing remote processing logic
      switch(source) {
        case 'sentinel2':
          return processSentinel2(state.dateRange.start, state.dateRange.end);
        case 'landsat':
          return processLandsat(state.dateRange.start, state.dateRange.end);
        default:
          updateStatus('Unknown image source: ' + source, true);
          return false;
      }
    }
  }

  // Add local file upload handling
  function addLocalFileUpload(panel) {
    var fileUpload = ui.Button({
      label: 'Upload Local Image',
      onClick: function() {
        // Create file input element
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.tif,.tiff';
        input.onchange = function(e) {
          var file = e.target.files[0];
          if (file) {
            processImage('local', file.path);
          }
        };
        input.click();
      },
      style: STYLES.button
    });
    panel.add(fileUpload);
  }

  // Remove the local file processing code and add an asset selector instead
  function addAssetSelector(panel) {
    panel.add(ui.Label('Select Sentinel-2 Band Asset:', STYLES.subheading));

    var assetTextbox = ui.Textbox({
      placeholder: 'users/YOUR_USERNAME/B08',
      style: {width: '250px'}
    });

    panel.add(assetTextbox);

    panel.add(ui.Button({
      label: 'Process Asset',
      onClick: function() {
        var assetId = assetTextbox.getValue();
        if (!assetId) {
          updateStatus('Please enter an asset ID', true);
          return;
        }

        try {
          var image = ee.Image(assetId);
          var waterMask = image.lt(state.waterThreshold || 0.2);

          var expandedAOI = state.aoi.buffer(500);
          var shoreline = vectorizeWaterMask(waterMask, expandedAOI);
          var clippedShoreline = shoreline.map(function(f) {
            return f.intersection(state.aoi);
          }).filterBounds(state.aoi);

          displayResults('asset', waterMask.clip(state.aoi), clippedShoreline);
        } catch (e) {
          updateStatus('Error processing asset: ' + e.message, true);
        }
      },
      style: STYLES.button
    }));
  }
