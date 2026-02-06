/**
 * @description
 *    calculate area
 * 
 * @author
 *    João Siqueira
 * 
 */

// Asset mapbiomas
var asset = "projects/mapbiomas-workspace/public/collection6/mapbiomas_collection60_integration_v1";

// Asset of regions for which you want to calculate statistics
var assetTerritories = "projects/mapbiomas-workspace/AUXILIAR/biomas-estados-2016-raster";

// Change the scale if you need.
var scale = 30;

// Define a list of years to export
var years = [
    '1985', '1986', '1987', '1988', '1989', '1990', '1991', '1992',
    '1993', '1994', '1995', '1996', '1997', '1998', '1999', '2000',
    '2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008',
    '2009', '2010', '2011', '2012', '2013', '2014', '2015', '2016',
    '2017', '2018', '2019', '2020'
];

// Define a Google Drive output folder 
var driverFolder = 'AREA-EXPORT';

/**
 * 
 */
// Territory image
var territory = ee.Image(assetTerritories);

// LULC mapbiomas image
var mapbiomas = ee.Image(asset).selfMask();

// Image area in km2
var pixelArea = ee.Image.pixelArea().divide(1000000);

// Geometry to export
var geometry = mapbiomas.geometry();

/**
 * OPTIMIZED: Single reduceRegion() call for all years
 * 
 * Strategy: Stack all classification bands into one image, multiply each by 
 * pixelArea, then reduce all at once. This replaces 36 reduceRegion() calls with 1.
 */

// Select all classification bands for the years we need
var bandNames = years.map(function(year) {
    return 'classification_' + year;
});

// Create the image stack: territory + all classification bands weighted by area
var classificationBands = mapbiomas.select(bandNames);

/**
 * Calculate area for all years and territories in a SINGLE reduceRegion call
 */
var calculateAllAreas = function () {
    // Create a reducer that computes frequency histogram for each band
    // grouped by territory. This gives us class counts per territory per year.
    var reducer = ee.Reducer.frequencyHistogram();
    
    // Reduce by territory - get histogram of classes for each band (year)
    var results = classificationBands.addBands(territory)
        .reduceRegion({
            reducer: reducer.group({
                groupField: bandNames.length,  // territory band is last
                groupName: 'territory'
            }),
            geometry: geometry,
            scale: scale,
            maxPixels: 1e12
        });
    
    var groups = ee.List(results.get('groups'));
    
    // Process each territory group
    var allFeatures = groups.map(function(group) {
        group = ee.Dictionary(group);
        var territoryId = group.get('territory');
        
        // For each year, extract the histogram and convert to features
        var yearFeatures = ee.List(bandNames).map(function(bandName) {
            bandName = ee.String(bandName);
            var year = bandName.slice(-4);  // Extract year from band name
            
            var histogram = ee.Dictionary(group.get(bandName));
            var classes = histogram.keys();
            
            return classes.map(function(classId) {
                // Histogram gives pixel counts, convert to area
                var pixelCount = ee.Number(histogram.get(classId));
                var areaKm2 = pixelCount.multiply(scale).multiply(scale).divide(1000000);
                
                return ee.Feature(null)
                    .set('territory', territoryId)
                    .set('class', ee.Number.parse(classId))
                    .set('area', areaKm2)
                    .set('year', year);
            });
        });
        
        return yearFeatures.flatten();
    });
    
    return ee.FeatureCollection(allFeatures.flatten());
};

// Calculate areas for all years in a single server operation
var areas = calculateAllAreas();

// Export a csv file to Google Drive
Export.table.toDrive({
    collection: areas,
    description: 'areas-teste-toolkit',
    folder: driverFolder,
    fileNamePrefix: 'areas-teste-toolkit',
    fileFormat: 'CSV'
});
