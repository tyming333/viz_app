const test = require("node:test");
const assert = require("node:assert/strict");
const { getImageAdjustmentFilter, getSharpenKernel } = require("../viewer-core.js");

test("default adjustments preserve the original and bypass sharpening", () => {
  assert.equal(getImageAdjustmentFilter({}), "brightness(1.00) contrast(1.00) saturate(1.00) grayscale(0.00)");
});

test("zero brightness and contrast are valid values", () => {
  assert.equal(getImageAdjustmentFilter({ brightness: 0, contrast: 0 }),
    "brightness(0.00) contrast(0.00) saturate(1.00) grayscale(0.00)");
});

test("color controls compose with optional sharpening", () => {
  assert.equal(getImageAdjustmentFilter({ brightness: 150, contrast: 125, saturation: 50, grayscale: 75, sharpness: 40 }),
    'brightness(1.50) contrast(1.25) saturate(0.50) grayscale(0.75) url("#imageSharpenFilter")');
});

test("sharpening preserves uniform colors and increases edge contrast", () => {
  assert.deepEqual(getSharpenKernel(0), [0, 0, 0, 0, 1, 0, 0, 0, 0]);
  const kernel = getSharpenKernel(50);
  assert.deepEqual(kernel, [0, -0.5, 0, -0.5, 3, -0.5, 0, -0.5, 0]);
  assert.equal(kernel.reduce((sum, weight) => sum + weight, 0), 1);
});

test("invalid and out-of-range settings are normalized", () => {
  assert.equal(getImageAdjustmentFilter({ brightness: -10, contrast: 800, saturation: NaN, grayscale: 120, sharpness: -1 }),
    "brightness(0.00) contrast(6.00) saturate(1.00) grayscale(1.00)");
  assert.deepEqual(getSharpenKernel(200), getSharpenKernel(100));
  assert.deepEqual(getSharpenKernel(NaN), getSharpenKernel(0));
});
