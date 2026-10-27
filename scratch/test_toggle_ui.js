const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../frontend/src/components/common/UserWizardModal.jsx');
const content = fs.readFileSync(filePath, 'utf8');

console.log('Verifying UserWizardModal.jsx toggle classes and attributes:');

// 1. Check enabled state track color (orange)
const hasOrangeTrack = content.includes('bg-orange-500 border-orange-600');
console.log('1. Has orange track for enabled state:', hasOrangeTrack);

// 2. Check disabled state track color (light grey)
const hasGreyTrack = content.includes('bg-slate-200 border-slate-300');
console.log('2. Has light-grey track for disabled state:', hasGreyTrack);

// 3. Check thumb styling (white, rounded-full, shadow-md, border)
const hasThumbStyle = content.includes('h-5 w-5 transform rounded-full bg-white shadow-md border border-black/10');
console.log('3. Has high-contrast thumb styling:', hasThumbStyle);

// 4. Check thumb positioning for both states
const hasTranslateEnabled = content.includes('translate-x-5');
const hasTranslateDisabled = content.includes('translate-x-0');
console.log('4. Thumb translates to right on enabled (translate-x-5):', hasTranslateEnabled);
console.log('5. Thumb translates to left on disabled (translate-x-0):', hasTranslateDisabled);

// 6. Check badge styling
const hasBadge = content.includes("{form.autoClockOutEnabled ? 'Enabled' : 'Disabled'}");
console.log('6. Has Enabled/Disabled badge:', hasBadge);

// 7. Check responsive layout
const hasResponsiveLayout = content.includes('flex flex-col sm:flex-row sm:items-center justify-between gap-3');
console.log('7. Has responsive desktop/tablet/mobile layout:', hasResponsiveLayout);

if (hasOrangeTrack && hasGreyTrack && hasThumbStyle && hasTranslateEnabled && hasTranslateDisabled && hasBadge && hasResponsiveLayout) {
  console.log('\n✓ ALL TOGGLE VISIBILITY UI CHECKS PASSED SUCCESSFULLY!');
} else {
  console.error('\n❌ SOME CHECKS FAILED!');
  process.exit(1);
}
