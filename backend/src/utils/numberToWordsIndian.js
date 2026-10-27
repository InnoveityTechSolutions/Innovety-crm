/**
 * Converts a numerical amount in INR to words using the Indian numbering system
 * (Crores, Lakhs, Thousands, Hundreds, Rupees, Paise).
 *
 * Example:
 *   11387.00 -> "Indian Rupee Eleven Thousand Three Hundred Eighty-Seven Only"
 *   250.50   -> "Indian Rupee Two Hundred Fifty and Fifty Paise Only"
 *   0        -> "Indian Rupee Zero Only"
 *
 * @param {number|string} amount
 * @returns {string} Amount formatted in words
 */
function numberToWordsIndian(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num < 0) {
    return 'Indian Rupee Zero Only';
  }

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'
  ];

  const tens = [
    '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'
  ];

  function convertTwoDigits(n) {
    if (n < 20) return ones[n];
    const t = tens[Math.floor(n / 10)];
    const o = ones[n % 10];
    return o ? `${t}-${o}` : t;
  }

  function convertThreeDigits(n) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    let res = '';
    if (h > 0) {
      res += `${ones[h]} Hundred`;
      if (rest > 0) res += ' ';
    }
    if (rest > 0) {
      res += convertTwoDigits(rest);
    }
    return res.trim();
  }

  const parts = Number(num).toFixed(2).split('.');
  let rupees = parseInt(parts[0], 10);
  const paise = parseInt(parts[1], 10);

  if (rupees === 0 && paise === 0) {
    return 'Indian Rupee Zero Only';
  }

  let words = '';

  // Crores (>= 1,00,00,000)
  if (rupees >= 10000000) {
    const crores = Math.floor(rupees / 10000000);
    words += `${convertThreeDigits(crores)} Crore `;
    rupees %= 10000000;
  }

  // Lakhs (>= 1,00,000)
  if (rupees >= 100000) {
    const lakhs = Math.floor(rupees / 100000);
    words += `${convertTwoDigits(lakhs)} Lakh `;
    rupees %= 100000;
  }

  // Thousands (>= 1,000)
  if (rupees >= 1000) {
    const thousands = Math.floor(rupees / 1000);
    words += `${convertTwoDigits(thousands)} Thousand `;
    rupees %= 1000;
  }

  // Hundreds & below (< 1,000)
  if (rupees > 0) {
    words += `${convertThreeDigits(rupees)} `;
  }

  words = words.trim();

  let result = words ? `Indian Rupee ${words}` : 'Indian Rupee Zero';

  if (paise > 0) {
    result += ` and ${convertTwoDigits(paise)} Paise`;
  }

  return `${result} Only`;
}

module.exports = {
  numberToWordsIndian
};
