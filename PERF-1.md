# Performance Optimization Analysis for MapBiomas User Toolkit

## Overview

This analysis covers 18 JavaScript files (~1MB total) for the MapBiomas User Toolkit - a Google Earth Engine (GEE) application suite for land use/land cover data visualization and export.

## Summary of Findings

| Priority | Category | Impact | Effort |
|----------|----------|--------|--------|
| 🔴 Critical | Redundant Asset Loading | High | Medium |
| 🔴 Critical | Chained `.where()` Operations | High | Low |
| 🟡 High | Repeated `ee.Image.pixelArea()` Calls | Medium | Low |
| 🟡 High | Missing `.aside()` for Debugging | Low | Low |
| 🟢 Medium | Code Duplication Across Files | Medium | High |
| 🟢 Medium | Static Data Initialization | Low | Low |

---

## 🔴 Critical Priority Optimizations

### 1. Redundant Asset Loading in Degradation Script

**File:** [mapbiomas-user-toolkit-degradation.js](file:///Users/dirceu-jr/Desktop/user-toolkit/mapbiomas-user-toolkit-degradation.js#L127-L175)

**Problem:** Multiple `ee.Image()` calls load the same asset base and then chain `.blend()` operations. Each `.blend()` call triggers additional server requests.

**Current Code (Lines 127-135):**
```javascript
var bordasArea = landcover_base.where(landcover_base.eq(1), 9)
  .blend(ee.Image('projects/mapbiomas-workspace/DEGRADACAO/.../edge_1000m_v3').gt(1).multiply(8))
  .blend(ee.Image('projects/mapbiomas-workspace/DEGRADACAO/.../edge_600m_v3').gt(1).multiply(7))
  .blend(ee.Image('projects/mapbiomas-workspace/DEGRADACAO/.../edge_300m_v3').gt(1).multiply(6))
  // ... 5 more blend operations
```

**Optimization:** Use `ee.ImageCollection` with `.mosaic()` and conditional logic instead of chained blends:

```javascript
// Load all edge images once as a collection
var edgeImages = ee.ImageCollection([
  ee.Image('projects/.../edge_30m_v3').multiply(1),
  ee.Image('projects/.../edge_60m_v3').multiply(2),
  ee.Image('projects/.../edge_90m_v3').multiply(3),
  // ... other edges
]);

// Use mosaic - later images take priority (reverse order)
var bordasArea = landcover_base.where(landcover_base.eq(1), 9)
  .blend(edgeImages.mosaic());
```

**Estimated Impact:** ~40-60% reduction in script initialization time.

---

### 2. Chained `.where()` Operations on Large Images

**Files:** 
- [mapbiomas-user-toolkit-degradation.js](file:///Users/dirceu-jr/Desktop/user-toolkit/mapbiomas-user-toolkit-degradation.js#L145-L175) (Lines 145-175)

**Problem:** Multiple chained `.where()` calls on `landcover_base` create redundant computation graphs:

```javascript
var distances100ha = landcover_base.multiply(0)
  .where(ee.Image('...'), 10)
  .where(ee.Image('...'), 2)
  .where(ee.Image('...'), 3)
  // ... 4 more .where() calls
```

**Optimization:** Use `ee.Image.remap()` or a single lookup table approach:

```javascript
// Pre-compute class values using a combined approach
var distanceClasses = ee.ImageCollection([
  ee.Image('projects/.../natural_mask_maior100ha').selfMask().multiply(10),
  ee.Image('projects/.../nat_uso_frag50__dist05k__100').selfMask().multiply(2),
  // ... others
]).max(); // or .mosaic() depending on priority
```

**Estimated Impact:** ~30-50% reduction in area calculation time.

---

## 🟡 High Priority Optimizations

### 3. Repeated `ee.Image.pixelArea()` Calls

**Files:** All toolkit files contain identical `Area.calculate()` function

**Locations:**
- [mapbiomas-user-toolkit-lulc.js](file:///Users/dirceu-jr/Desktop/user-toolkit/mapbiomas-user-toolkit-lulc.js#L123-L143) (Lines 123-143)
- [mapbiomas-user-toolkit-fire.js](file:///Users/dirceu-jr/Desktop/user-toolkit/mapbiomas-user-toolkit-fire.js#L103-L123) (Lines 103-123)
- [mapbiomas-user-toolkit-degradation.js](file:///Users/dirceu-jr/Desktop/user-toolkit/mapbiomas-user-toolkit-degradation.js#L78-L98) (Lines 78-98)
- Plus 5 other files

**Problem:** Each file independently calls `ee.Image.pixelArea().divide(object.factor)` which could be cached.

**Current Code:**
```javascript
calculate: function (object) {
    var reducer = ee.Reducer.sum().group(1, 'class').group(1, 'territory');
    var pixelArea = ee.Image.pixelArea().divide(object.factor);
    // ...
}
```

**Optimization:** Create a shared module or cache the pixel area image:

```javascript
// In a shared module
var CachedArea = {
    _pixelAreaKm2: null,
    _pixelAreaHa: null,
    
    getPixelArea: function(unit) {
        if (unit === 'km2') {
            if (!this._pixelAreaKm2) {
                this._pixelAreaKm2 = ee.Image.pixelArea().divide(1e6);
            }
            return this._pixelAreaKm2;
        }
        // ... handle other units
    }
};
```

**Estimated Impact:** Minor improvement (~5-10%) but reduces code duplication.

---

### 4. Remap Operations Using forEach

**File:** [mapbiomas-user-toolkit-degradation.js](file:///Users/dirceu-jr/Desktop/user-toolkit/mapbiomas-user-toolkit-degradation.js#L110-L113) (Lines 110-113)

**Problem:** JavaScript `forEach` loop with `.where()` is inefficient:

```javascript
var landcover_remap = landcover.multiply(0);
mb_landcover_values.forEach(function(classe, i) {
  landcover_remap = landcover_remap.where(landcover.eq(classe), mb_vegNat_values[i]);
});
```

**Optimization:** Use native GEE `remap()`:

```javascript
var landcover_remap = landcover.remap(mb_landcover_values, mb_vegNat_values, 0);
```

**Estimated Impact:** ~20-30% faster remap operations.

---

## 🟢 Medium Priority Optimizations

### 5. Substantial Code Duplication

**Problem:** The `Area` object (convert2table + calculate functions) is duplicated across all 8+ toolkit files with near-identical implementations.

**Files Affected:**
- mapbiomas-user-toolkit-lulc.js
- mapbiomas-user-toolkit-fire.js
- mapbiomas-user-toolkit-degradation.js
- mapbiomas-user-toolkit-water.js
- mapbiomas-user-toolkit-irrigation.js
- mapbiomas-user-toolkit-deforestation-regeneration.js
- mapbiomas-user-toolkit-mining.js
- mapbiomas-user-toolkit-pasture.js
- mapbiomas-user-toolkit-soil.js

**Optimization:** Extract to a shared GEE module:

```javascript
// users/mapbiomas/modules:AreaCalculator.js
exports.Area = {
    convert2table: function(obj) { /* ... */ },
    calculate: function(object) { /* ... */ }
};
```

Then in each toolkit:
```javascript
var Area = require('users/mapbiomas/modules:AreaCalculator.js').Area;
```

**Estimated Impact:** Reduced maintenance burden, consistent behavior, easier updates.

---

### 6. Feature Collection Filtering Optimization

**File:** [mapbiomas-user-toolkit-irrigation.js](file:///Users/dirceu-jr/Desktop/user-toolkit/mapbiomas-user-toolkit-irrigation.js#L689-L690) (Lines 689-690)

**Problem:** Using deprecated `filterMetadata()`:

```javascript
App.options.table = ee.FeatureCollection(tableName)
    .filterMetadata('UF', 'equals', parseInt(App.options.statesNames[state], 10));
```

**Optimization:** Use modern `filter()` with `ee.Filter`:

```javascript
App.options.table = ee.FeatureCollection(tableName)
    .filter(ee.Filter.eq('UF', parseInt(App.options.statesNames[state], 10)));
```

---

### 7. Export Dimension Standardization

**Notes from [mapbiomas-user-toolkit-fire.js](file:///Users/dirceu-jr/Desktop/user-toolkit/mapbiomas-user-toolkit-fire.js#L30-L31) comments (Lines 30-31):**

The developers have already addressed some performance issues:
- Standardizing `Export.image` dimensions to `256 * 124`  
- Replacing `.clip()` with mask operations

This is good practice - continue applying this pattern to other toolkits.

---

## Verification Plan

Since this is a Google Earth Engine codebase that runs in the GEE Code Editor, traditional unit testing is not applicable. Verification will require:

### Manual Verification
1. **Open scripts in GEE Code Editor** and check for:
   - Console errors on load
   - Correct layer rendering
   - Export functionality working

2. **Performance comparison** (before/after):
   - Note layer load times
   - Check GEE profiler for computation time

### Recommended Testing Approach
Ask the user to:
1. Test a modified script in GEE Code Editor
2. Compare load times with the original
3. Verify that exported data matches expected outputs

---

## Implementation Recommendations

Given this is a user toolkit for MapBiomas data users, I recommend:

1. **Start with low-risk, high-impact changes:**
   - Replace `forEach` remap with `ee.Image.remap()` (Line 110-113 in degradation.js)
   - Update deprecated `filterMetadata()` calls

2. **Coordinate with the MapBiomas team** for:
   - Creating a shared `AreaCalculator` module
   - Refactoring the chained `.blend()` operations

3. **Document performance improvements** for users who may have forked older versions.

---

## Next Steps

Please review this analysis and let me know:

1. Which optimizations would you like me to implement?
2. Should I focus on a specific file or apply changes across all files?
3. Do you have access to test the changes in the GEE Code Editor?
