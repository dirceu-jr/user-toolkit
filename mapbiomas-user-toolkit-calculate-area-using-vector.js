/**
 * @description
 *    Calculates area by class id and year
 * 
 * @author
 *    João Siqueira
 * 
 */

// Asset mapbiomas
var asset = "projects/mapbiomas-workspace/public/collection8/mapbiomas_collection80_integration_v1";

// Asset of regions for which you want to calculate statistics
var assetTerritories = "users/joaovsiqueira1/MAPBIOMAS/ti_uc";

// Numeric attribute to index the shapefile
var attribute = "id_arp";

// A list of class ids you are interested
var classIds = [
    3, // Formação Florestal
    4, // Formação Savânica
    5, // Mangue
    49, // Restinga Florestal
    11, // Área Úmida Natural não Florestal
    12, // Formação Campestre
    32, // Apicum
    29, // Afloramento Rochoso
    13, // Outra Formação não Florestal
    18, // Agricultura
    39, // Soja
    20, // Cana
    40, // Arroz
    41, // Outras Lavouras Temporárias
    46, // Café
    47, // Citrus
    48, // Outras Lavaouras Perenes
    9, // Silvicultura
    15, // Pastagem
    21, // Mosaico de Agricultura ou Pastagem
    22, // Área não Vegetada
    23, // Praia e Duna
    24, // Infraestrutura Urbana
    30, // Mineração
    25, // Outra Área não Vegetada
    33, // Rio, Lago e Oceano
    31 // 'Aquicultura
];

// Output csv name
var outputName = 'areas';

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
// Territory
var territory = ee.FeatureCollection(assetTerritories);

// LULC mapbiomas image
var mapbiomas = ee.Image(asset).selfMask();

// Image area in km2
var pixelArea = ee.Image.pixelArea().divide(1000000);

// Pre-rasterize territory collection ONCE (Optimization #3)
// This avoids recreating a territory image for each feature in each year
var territoryImage = territory
    .reduceToImage([attribute], ee.Reducer.first())
    .rename('territory');

// Use territory bounds instead of full mapbiomas extent
var geometry = territory.geometry();

/**
 * Convert a complex ob to feature collection
 * @param obj 
 */
var convert2table = function (obj) {

    obj = ee.Dictionary(obj);

    var territory = obj.get('territory');

    var classesAndAreas = ee.List(obj.get('groups'));

    var tableRows = classesAndAreas.map(
        function (classAndArea) {
            classAndArea = ee.Dictionary(classAndArea);

            var classId = classAndArea.get('class');
            var area = classAndArea.get('sum');

            var tableColumns = ee.Feature(null)
                .set(attribute, territory)
                .set('class', classId)
                .set('area', area);

            return tableColumns;
        }
    );

    return ee.FeatureCollection(ee.List(tableRows));
};

/**
 * Calculate area crossing a cover map (deforestation, mapbiomas)
 * and a region map (states, biomes, municipalites)
 * @param image 
 * @param territory 
 * @param geometry
 */
/**
 * Calculate area for ALL territories at once using pre-rasterized territory image
 * (Optimization #1: Batch processing instead of per-feature)
 * @param image - The classification image for a specific year
 */
var calculateArea = function (image) {

    var reducer = ee.Reducer.sum().group(1, 'class').group(1, 'territory');

    var territoriesData = pixelArea.addBands(territoryImage).addBands(image)
        .reduceRegion({
            reducer: reducer,
            geometry: geometry,
            scale: scale,
            maxPixels: 1e12
        });

    territoriesData = ee.List(territoriesData.get('groups'));

    var areas = territoriesData.map(convert2table);

    areas = ee.FeatureCollection(areas).flatten();

    return areas;
};

// Create a mask to filter only the classes we're interested in (Optimization #2)
// This replaces the redundant remap(classIds, classIds, 0) that mapped values to themselves
var classIdsList = ee.List(classIds);
var createClassMask = function(image) {
    // Keep only pixels with class IDs in our list, set others to 0
    var mask = classIdsList.iterate(function(classId, acc) {
        return ee.Image(acc).or(image.eq(ee.Number(classId)));
    }, ee.Image(0));
    return image.updateMask(mask);
};

// Process all years with batch territory processing (Optimization #1)
var areas = years.map(
    function (year) {
        var image = mapbiomas.select('classification_' + year);
        
        // Apply class filter instead of redundant remap
        image = createClassMask(image);

        // Single reduceRegion call processes ALL territories at once
        var yearAreas = calculateArea(image);

        // Set year property
        yearAreas = yearAreas.map(
            function (feature) {
                return feature.set('year', year);
            }
        );

        return yearAreas;
    }
);

areas = ee.FeatureCollection(areas).flatten();

Map.addLayer(territory);

Export.table.toDrive({
    collection: areas,
    description: outputName,
    folder: driverFolder,
    fileNamePrefix: outputName,
    fileFormat: 'CSV'
});
