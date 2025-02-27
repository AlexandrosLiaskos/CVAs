/*********************************
 * Coastal Slope Analysis Module
 * @version 1.2.0
 *********************************/

/**
 * Minimal styles and icons - will use provided ones from parent module when available
 */
var DEFAULT_STYLES = {
  heading:    {fontSize: '24px', fontWeight: 'bold', margin: '10px 0'},
  subheading: {fontSize: '16px', fontWeight: 'bold', margin: '8px 0'},
  text:       {fontSize: '14px', margin: '5px 0'},
  button:     {margin: '5px 0', backgroundColor: 'white'}
};

var DEFAULT_ICONS = {
  info: 'ⓘ',
  settings: '⚙️',
  results: '📊',
  help: '❓',
  download: '⬇️',
  warning: '⚠️',
  back: '⬅️',
  next: '➡️'
};

/**
 * A slope vulnerability classification function.
 * @param {number} slopeDegrees - Slope angle in degrees
 * @return {Object} Vulnerability rating info
 */
function getSlopeVulnerabilityCategory(slopeDegrees) {
  if (slopeDegrees < 0.5) {
    return {
      rating: 'Very High',
      color: '#d32f2f',
      description: 'Very low slope areas (<0.5°) are highly vulnerable to flooding and erosion.'
    };
  } else if (slopeDegrees < 1) {
    return {
      rating: 'High',
      color: '#f57c00',
      description: 'Low slope (0.5-1°) - high vulnerability to sea level rise impacts.'
    };
  } else if (slopeDegrees < 2) {
    return {
      rating: 'Moderate',
      color: '#fbc02d',
      description: 'Moderate slope (1-2°) - medium vulnerability to coastal hazards.'
    };
  } else if (slopeDegrees < 5) {
    return {
      rating: 'Low',
      color: '#689f38',
      description: 'Steep slope (2-5°) provides natural protection from flooding.'
    };
  } else {
    return {
      rating: 'Very Low',
      color: '#2e7d32',
      description: 'Very steep slope (>5°) offers excellent protection from coastal hazards.'
    };
  }
}

/**
 * Available DEM sources in Google Earth Engine.
 */
var demSources = [
  {
    label: 'SRTM (Shuttle Radar Topography Mission)',
    value: 'SRTM',
    collection: 'USGS/SRTMGL1_003',
    band: 'elevation',
    resolution: 30,
    description: 'Global 30m DEM from NASA (2000). Coverage: ±60° latitude.'
  },
  {
    label: 'ALOS World 3D (AW3D30)',
    value: 'ALOS',
    collection: 'JAXA/ALOS/AW3D30/V2_2',
    band: 'DSM',
    resolution: 30,
    description: 'Global 30m DEM from JAXA (2006-2011). More recent than SRTM.'
  },
  {
    label: 'NASADEM',
    value: 'NASADEM',
    collection: 'NASA/NASADEM_HGT/001',
    band: 'elevation',
    resolution: 30,
    description: 'Enhanced SRTM data with improved coastal accuracy.'
  },
  {
    label: 'Copernicus GLO-30',
    value: 'COPERNICUS',
    collection: 'COPERNICUS/DEM/GLO30',
    band: 'elevation',
    resolution: 30,
    description: 'Global 30m DEM from Copernicus (2019-2020).'
  },
  {
    label: 'MERIT DEM',
    value: 'MERIT',
    collection: 'MERIT/Hydro/v1_0_1',
    band: 'dem',
    resolution: 90,
    description: 'Error-reduced global DEM at 90m. Better for flat coastal areas.'
  }
];

/**
 * Creates a section header with optional info tooltip
 */
function createSectionHeader(title, info, ICONS, STYLES) {
  var header = ui.Label(title, STYLES.subheading);

  if (!info) {
    return header;
  }

  // Create an info tooltip
  var infoButton = ui.Button({
    label: ICONS.info,
    onClick: function() {
      ui.alert(title, info);
    },
    style: {
      padding: '0 3px',
      margin: '0 0 0 5px'
    }
  });

  var panel = ui.Panel({
    widgets: [header, infoButton],
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {padding: '0', margin: '5px 0'}
  });

  return panel;
}

/**
 * Creates the slope analysis UI after a shoreline is loaded.
 * @param {ee.FeatureCollection} shoreline - Vectorized shoreline
 * @param {ui.Map} map - The map to display results on
 * @param {Function} updateStatus - Optional function to display status messages
 * @param {Object} STYLES - Optional styles to use
 * @param {Object} ICONS - Optional icons to use
 * @return {ui.Panel} The UI panel for slope analysis
 */
function createSlopeAnalysisUI(shoreline, map, updateStatus, STYLES, ICONS) {
  // Use provided styles/icons or fallback to defaults
  STYLES = STYLES || DEFAULT_STYLES;
  ICONS = ICONS || DEFAULT_ICONS;

  // Create an updateStatus function if none provided
  updateStatus = updateStatus || function(message) {
    print(message);
  };

  var panel = ui.Panel({
    layout: ui.Panel.Layout.flow('vertical'),
    style: {width: '350px', padding: '10px'}
  });

  // Show the shoreline on the map
  map.layers().reset();
  map.addLayer(shoreline, {color: 'red'}, 'Shoreline');
  map.centerObject(shoreline, 10);

  // Step progress indicators
  var stepPanel = ui.Panel({
    widgets: [
      ui.Label('Step 1: Select DEM', {fontWeight: 'bold', color: '#4285F4'}),
      ui.Label(' > '),
      ui.Label('Step 2: Configure', {color: '#888'}),
      ui.Label(' > '),
      ui.Label('Step 3: Results', {color: '#888'})
    ],
    layout: ui.Panel.Layout.flow('horizontal'),
    style: {margin: '0 0 15px 0'}
  });

  // State to track current analysis
  var state = {
    selectedDEM: null,
    bufferDistance: 1000,
    slopeCalculated: false,
    slopeImage: null,
    coastalZone: null,
    currentStep: 1  // Track which step/page we're on
  };

  // Content panel that will change based on the current step
  var contentPanel = ui.Panel();

  // Function to show the DEM selection page (step 1)
  function showDEMSelectionPage() {
    // Update step indicators
    stepPanel.widgets().get(0).style().set({fontWeight: 'bold', color: '#4285F4'});
    stepPanel.widgets().get(2).style().set({fontWeight: 'normal', color: '#888'});
    stepPanel.widgets().get(4).style().set({fontWeight: 'normal', color: '#888'});
    state.currentStep = 1;

    contentPanel.clear();

    // Add DEM selection panel
    contentPanel.add(createSectionHeader('Select Digital Elevation Model',
      'Choose the Digital Elevation Model source for slope calculation.',
      ICONS, STYLES));

    // Information about DEM selection
    contentPanel.add(ui.Label({
      value: 'The DEM source affects the accuracy of coastal slope values.',
      style: {fontSize: '13px', margin: '5px 0'}
    }));

    // Create DEM selection dropdown
    var demSelect = ui.Select({
      items: demSources.map(function(dem) { return dem.label; }),
      placeholder: 'Select DEM source',
      onChange: function(selected) {
        // Find the selected DEM source
        var selectedDEM = null;
        for (var i = 0; i < demSources.length; i++) {
          if (demSources[i].label === selected) {
            selectedDEM = demSources[i];
            break;
          }
        }

        // Update state
        state.selectedDEM = selectedDEM;

        // Show information about the selected DEM
        demInfoLabel.setValue(selectedDEM.description);
        demResolutionLabel.setValue('Resolution: ' + selectedDEM.resolution + 'm');

        // Update resolution warning if necessary
        if (selectedDEM.resolution > 30) {
          resolutionWarning.style().set('shown', true);
        } else {
          resolutionWarning.style().set('shown', false);
        }

        // Enable the next button
        nextButton.setDisabled(false);

        updateStatus('Selected DEM: ' + selectedDEM.label);
      },
      style: {width: '300px', margin: '5px 0'}
    });
    contentPanel.add(demSelect);

    // Information labels for the selected DEM
    var demInfoLabel = ui.Label({
      value: 'Please select a DEM source from the dropdown above.',
      style: {fontSize: '12px', color: '#666', margin: '5px 0'}
    });
    contentPanel.add(demInfoLabel);

    var demResolutionLabel = ui.Label({
      value: '',
      style: {fontSize: '12px', color: '#666', margin: '2px 0'}
    });
    contentPanel.add(demResolutionLabel);

    // Warning for low-resolution DEMs
    var resolutionWarning = ui.Label({
      value: ICONS.warning + ' Warning: This DEM has lower resolution (>30m) ' +
             'which may affect coastal slope accuracy.',
      style: {fontSize: '12px', color: '#f57c00', margin: '5px 0', shown: false}
    });
    contentPanel.add(resolutionWarning);

    // Next button
    var nextButton = ui.Button({
      label: 'Next: Configure Analysis ' + ICONS.next,
      onClick: function() {
        showAnalysisSettingsPage();
      },
      disabled: state.selectedDEM === null,
      style: STYLES.button
    });
    contentPanel.add(nextButton);
  }

  // Function to show analysis settings page (step 2)
  function showAnalysisSettingsPage() {
    // Update step indicators
    stepPanel.widgets().get(0).style().set({fontWeight: 'normal', color: '#888'});
    stepPanel.widgets().get(2).style().set({fontWeight: 'bold', color: '#4285F4'});
    stepPanel.widgets().get(4).style().set({fontWeight: 'normal', color: '#888'});
    state.currentStep = 2;

    contentPanel.clear();

    // Show which DEM was selected
    contentPanel.add(ui.Label('Selected DEM Source:', {fontWeight: 'bold', margin: '5px 0'}));
    contentPanel.add(ui.Label(state.selectedDEM.label, {margin: '3px 0 10px 0'}));

    // Analysis settings panel
    contentPanel.add(createSectionHeader('Analysis Settings',
      'Configure the coastal slope calculation parameters.',
      ICONS, STYLES));

    contentPanel.add(ui.Label('Coastal Buffer Distance (m):', {margin: '4px 0'}));
    var bufferSlider = ui.Slider({
      min: 300,
      max: 3000,
      value: state.bufferDistance,
      step: 100,
      style: {width: '280px'},
      onChange: function(value) {
        state.bufferDistance = value;
      }
    });
    contentPanel.add(bufferSlider);

    contentPanel.add(ui.Label({
      value: 'The buffer distance determines how far inland and offshore ' +
             'from the shoreline to analyze slope values.',
      style: {fontSize: '12px', color: '#666', margin: '3px 0 15px 0'}
    }));

    // Navigation buttons
    var buttonPanel = ui.Panel({
      widgets: [
        ui.Button({
          label: ICONS.back + ' Back',
          onClick: function() {
            showDEMSelectionPage();
          },
          style: STYLES.button
        }),
        ui.Button({
          label: 'Calculate Slope ' + ICONS.next,
          onClick: function() {
            // Show loading message
            contentPanel.clear();
            contentPanel.add(ui.Label('Calculating coastal slope...',
              {margin: '10px 0', fontSize: '16px'}));
            contentPanel.add(ui.Label({
              value: 'This may take a moment depending on the size of the shoreline.',
              style: {fontSize: '13px', color: '#666'}
            }));

            // Start calculation and then show results page
            calculateCoastalSlope(shoreline, state, map, contentPanel, function(message, isError) {
              updateStatus(message, isError);
              if (!isError) {
                showResultsPage();
              } else {
                // If there was an error, add back button
                contentPanel.add(ui.Button({
                  label: ICONS.back + ' Back to Settings',
                  onClick: showAnalysisSettingsPage,
                  style: STYLES.button
                }));
              }
            }, STYLES, ICONS);
          },
          style: STYLES.button
        })
      ],
      layout: ui.Panel.Layout.flow('horizontal'),
      style: {margin: '5px 0'}
    });
    contentPanel.add(buttonPanel);
  }

  // Function to show results page (step 3)
  function showResultsPage() {
    // Update step indicators
    stepPanel.widgets().get(0).style().set({fontWeight: 'normal', color: '#888'});
    stepPanel.widgets().get(2).style().set({fontWeight: 'normal', color: '#888'});
    stepPanel.widgets().get(4).style().set({fontWeight: 'bold', color: '#4285F4'});
    state.currentStep = 3;

    contentPanel.clear();

    // Add results header
    contentPanel.add(ui.Label({
      value: ICONS.results + ' Slope Analysis Results',
      style: STYLES.subheading
    }));

    // Add loading indicator
    var loadingLabel = ui.Label({
      value: 'Calculating statistics...',
      style: {fontSize: '13px', margin: '5px 0', color: '#2196F3'}
    });
    contentPanel.add(loadingLabel);

    // Calculate statistics
    var stats = state.slopeImage.reduceRegion({
      reducer: ee.Reducer.mean().combine(ee.Reducer.stdDev(), null, true)
                               .combine(ee.Reducer.minMax(), null, true),
      geometry: state.coastalZone,
      scale: state.selectedDEM.resolution,
      maxPixels: 1e9,
      bestEffort: true
    });

    // When stats are ready, display them
    stats.evaluate(function(statValues) {
      // Remove loading indicator
      contentPanel.remove(loadingLabel);

      if (statValues) {
        // For different DEM sources, the band names in the stats might vary
        var bandName = state.selectedDEM.band;
        var meanKey = bandName + '_mean';
        var minKey = bandName + '_min';
        var maxKey = bandName + '_max';
        var stdDevKey = bandName + '_stdDev';

        // Mean slope (most important value)
        var meanSlope = Math.round(statValues[meanKey] * 100) / 100;

        // Create a results card
        var resultsCard = ui.Panel({
          style: {
            padding: '15px',
            backgroundColor: 'white',
            border: '1px solid #ddd',
            margin: '5px 0 15px 0'
          }
        });

        resultsCard.add(ui.Label({
          value: 'Coastal Slope Summary',
          style: {fontSize: '16px', fontWeight: 'bold', margin: '0 0 10px 0'}
        }));

        resultsCard.add(ui.Label({
          value: 'Average Coastal Slope: ' + meanSlope + '°',
          style: {fontSize: '14px', margin: '3px 0', fontWeight: 'bold'}
        }));

        // Min and max in one line to save space
        resultsCard.add(ui.Label({
          value: 'Range: ' + Math.round(statValues[minKey] * 100) / 100 + '° to ' +
                 Math.round(statValues[maxKey] * 100) / 100 + '°',
          style: {fontSize: '13px', margin: '3px 0'}
        }));

        resultsCard.add(ui.Label({
          value: 'Standard Deviation: ' + Math.round(statValues[stdDevKey] * 100) / 100 + '°',
          style: {fontSize: '13px', margin: '3px 0'}
        }));

        // Add to main content
        contentPanel.add(resultsCard);

        // Add vulnerability assessment
        var vulnerability = getSlopeVulnerabilityCategory(meanSlope);

        // Create vulnerability card
        var vulnCard = ui.Panel({
          style: {
            padding: '15px',
            backgroundColor: 'white',
            border: '1px solid ' + vulnerability.color,
            margin: '5px 0 15px 0'
          }
        });

        vulnCard.add(ui.Label({
          value: 'Vulnerability Assessment',
          style: {fontSize: '16px', fontWeight: 'bold', margin: '0 0 10px 0'}
        }));

        // Add a colored vulnerability indicator
        var vulnPanel = ui.Panel({
          widgets: [
            ui.Label('Rating:', {fontSize: '13px', margin: '8px 0', fontWeight: 'bold'}),
            ui.Label({
              value: vulnerability.rating,
              style: {
                fontSize: '14px',
                margin: '0 0 0 8px',
                padding: '3px 8px',
                color: 'white',
                backgroundColor: vulnerability.color
              }
            })
          ],
          layout: ui.Panel.Layout.flow('horizontal'),
          style: {margin: '5px 0'}
        });
        vulnCard.add(vulnPanel);

        vulnCard.add(ui.Label({
          value: vulnerability.description,
          style: {fontSize: '12px', margin: '3px 0', color: '#666'}
        }));

        contentPanel.add(vulnCard);

        // Add export options
        contentPanel.add(ui.Label('Export Options:', {fontWeight: 'bold', margin: '10px 0 5px 0'}));

        // Add export button
        contentPanel.add(ui.Button({
          label: ICONS.download + ' Export Slope Data (GeoTIFF)',
          onClick: function() {
            Export.image.toDrive({
              image: state.slopeImage,
              description: 'Coastal_Slope_' + Date.now(),
              scale: state.selectedDEM.resolution,
              region: state.coastalZone,
              maxPixels: 1e13
            });

            contentPanel.add(ui.Label('✓ Export started! Check Tasks panel.', {
              color: '#2E7D32', margin: '5px 0', fontSize: '12px'
            }));
          },
          style: STYLES.button
        }));

      } else {
        // Error handling
        contentPanel.add(ui.Label({
          value: 'Statistics calculation failed. The area may be too large or have no data.',
          style: {fontSize: '13px', color: 'red', margin: '3px 0'}
        }));
      }

      // Add back button
      contentPanel.add(ui.Button({
        label: ICONS.back + ' Back to Settings',
        onClick: showAnalysisSettingsPage,
        style: STYLES.button
      }));
    });
  }

  // Add the step panel and content panel to the main panel
  panel.add(stepPanel);
  panel.add(contentPanel);

  // Initialize with the first page
  showDEMSelectionPage();

  return panel;
}

/**
 * Calculates coastal slope from a selected DEM using a shoreline
 */
function calculateCoastalSlope(shoreline, state, map, panel, updateStatus, STYLES, ICONS) {
  var demSource = state.selectedDEM;
  updateStatus('Calculating coastal slope using ' + demSource.label + '...');

  try {
    // Buffer the shoreline to create a coastal zone for analysis
    var coastalZone = shoreline.geometry().buffer(state.bufferDistance);
    state.coastalZone = coastalZone;

    // Load the DEM
    var dem = ee.Image(demSource.collection).select(demSource.band);

    // Clip to coastal zone
    var coastalDEM = dem.clip(coastalZone);

    // Calculate slope (in degrees)
    var slope = ee.Terrain.slope(coastalDEM);
    state.slopeImage = slope;

    // Add to map
    map.addLayer(slope,
      {min: 0, max: 10, palette: ['blue', 'cyan', 'green', 'yellow', 'red']},
      'Coastal Slope (' + demSource.label + ')',
      true);

    state.slopeCalculated = true;
    updateStatus('Coastal slope analysis complete');

  } catch (e) {
    updateStatus('Error in coastal slope calculation: ' + e.message, true);
    panel.add(ui.Label({
      value: ICONS.warning + ' Error: ' + e.message,
      style: {color: 'red', fontWeight: 'bold', margin: '5px 0'}
    }));
  }
}

// Export the functions for use in other modules
exports.createSlopeAnalysisUI = createSlopeAnalysisUI;
exports.getSlopeVulnerabilityCategory = getSlopeVulnerabilityCategory;
exports.demSources = demSources;

// ================ STANDALONE APP STARTUP CODE ================
// Create the standalone UI when this script is run directly
// Setup main UI elements
ui.root.clear();

// Create the layout: map on left, panel on right
var map = ui.Map();
map.style().set('cursor', 'crosshair');

var mainPanel = ui.Panel({style: {width: '360px', padding: '10px'}});
var layout = ui.SplitPanel({
  firstPanel: map,
  secondPanel: mainPanel
});

ui.root.add(layout);

// Show welcome screen function
function showWelcomeScreen() {
  mainPanel.clear();
  map.layers().reset();
  map.setCenter(0, 0, 2);

  // App title with version
  var titleLabel = ui.Label({
    value: 'Coastal Slope Analysis Tool v1.2.0',
    style: {
      fontSize: '20px',
      fontWeight: 'bold',
      margin: '10px 0',
      padding: '5px 0'
    }
  });

  // Add a separator panel
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
      ui.Label('Welcome to the Coastal Slope Analysis Tool', DEFAULT_STYLES.subheading),
      ui.Label({
        value: 'This application calculates coastal slope from shoreline data ' +
               'to help assess coastal vulnerability to sea level rise and other hazards.',
        style: {fontSize: '14px', margin: '5px 0'}
      }),
      ui.Label({
        value: 'The tool provides:',
        style: {fontSize: '14px', margin: '5px 0'}
      }),
      ui.Label({
        value: '• Multiple DEM sources for slope calculation',
        style: {fontSize: '13px', margin: '2px 0 2px 10px'}
      }),
      ui.Label({
        value: '• Vulnerability assessment based on slope values',
        style: {fontSize: '13px', margin: '2px 0 2px 10px'}
      }),
      ui.Label({
        value: '• Statistical analysis of coastal topography',
        style: {fontSize: '13px', margin: '2px 0 2px 10px'}
      }),
      ui.Label({
        value: '• Export options for further analysis',
        style: {fontSize: '13px', margin: '2px 0 2px 10px'}
      }),
      ui.Label({
        value: 'Get started by using the example shoreline or loading your own shoreline asset.',
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

  // Option panel for shoreline input
  var inputPanel = ui.Panel({
    style: {
      margin: '5px 0',
      padding: '15px',
      border: '1px solid #ddd',
      backgroundColor: 'white'
    }
  });

  // Example button with icon
  var exampleButton = ui.Button({
    label: DEFAULT_ICONS.info + ' Use Example Shoreline',
    onClick: function() {
      // This is a simplified example - in a real app you'd use an actual asset ID
      // This just creates a sample line to demonstrate
      var sampleLine = ee.Geometry.LineString([
        [-122.5, 37.8],
        [-122.4, 37.7],
        [-122.3, 37.75]
      ]);
      var sampleShoreline = ee.FeatureCollection([ee.Feature(sampleLine)]);

      // Load the slope analysis UI with example data
      loadSlopeAnalysis(sampleShoreline);
    },
    style: DEFAULT_STYLES.button
  });
  inputPanel.add(exampleButton);

  // Or load your own asset
  inputPanel.add(ui.Label('Or load your own shoreline asset:',
    {margin: '15px 0 5px 0', fontWeight: 'bold'}));

  // Asset input
  var assetTextbox = ui.Textbox({
    placeholder: 'users/username/shoreline_asset',
    style: {width: '100%', margin: '5px 0'}
  });
  inputPanel.add(assetTextbox);

  // Load button with icon
  var loadButton = ui.Button({
    label: DEFAULT_ICONS.next + ' Load Shoreline Asset',
    onClick: function() {
      var assetId = assetTextbox.getValue();
      if (!assetId) {
        ui.alert('Please enter an asset ID');
        return;
      }

      try {
        var shoreline = ee.FeatureCollection(assetId);
        loadSlopeAnalysis(shoreline);
      } catch (err) {
        ui.alert('Error loading asset: ' + err.message);
      }
    },
    style: DEFAULT_STYLES.button
  });
  inputPanel.add(loadButton);

  mainPanel.add(inputPanel);

  // Credits and about section
  var aboutPanel = ui.Panel({
    widgets: [
      ui.Label('About', {fontWeight: 'bold', margin: '5px 0'}),
      ui.Label({
        value: 'This tool uses Earth Engine to process DEM data and ' +
               'calculate coastal slope values. Slope is a key parameter in ' +
               'coastal vulnerability assessment frameworks.',
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

  print('Slope Analysis Tool Ready');
}

// Function to load slope analysis UI
function loadSlopeAnalysis(shoreline) {
  mainPanel.clear();
  mainPanel.add(ui.Label('Coastal Slope Analysis', DEFAULT_STYLES.heading));

  // Add back button
  mainPanel.add(ui.Button({
    label: DEFAULT_ICONS.back + ' Back to Welcome Screen',
    onClick: function() {
      showWelcomeScreen();
    },
    style: DEFAULT_STYLES.button
  }));

  // Create slope analysis panel
  var slopePanel = createSlopeAnalysisUI(
    shoreline,
    map,
    function(msg) { print(msg); }, // Use print instead of console.log
    DEFAULT_STYLES,
    DEFAULT_ICONS
  );

  // Add all panel widgets to main panel
  slopePanel.widgets().forEach(function(widget) {
    mainPanel.add(widget);
  });
}

// Initialize the welcome screen
showWelcomeScreen();
