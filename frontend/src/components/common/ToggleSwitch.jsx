import React from 'react';

/**
 * Reusable accessible Toggle / Switch component with guaranteed high-contrast
 * visibility in both ON and OFF states across light and dark themes.
 *
 * @param {boolean} checked - Switch ON/OFF state
 * @param {function} onChange - Change callback: (nextChecked: boolean, event: React.SyntheticEvent) => void
 * @param {boolean} [disabled=false] - Disables interaction and dims opacity
 * @param {string} [size='md'] - 'sm' | 'md' | 'lg'
 * @param {string} [id] - Optional HTML id
 * @param {string} [name] - Optional form field name
 * @param {string} [className] - Optional custom classes for the track
 * @param {string} [ariaLabel] - Accessibility label
 * @param {string} [title] - Tooltip text
 */
export const ToggleSwitch = ({
  checked = false,
  onChange,
  disabled = false,
  size = 'md',
  id,
  name,
  className = '',
  ariaLabel,
  title,
  ...props
}) => {
  const isChecked = Boolean(checked);

  const handleClick = (e) => {
    if (disabled || !onChange) return;
    onChange(!isChecked, e);
  };

  const handleKeyDown = (e) => {
    if (disabled || !onChange) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!isChecked, e);
    }
  };

  // Dimensions & translation per size
  const sizeConfig = {
    sm: {
      track: 'w-9 h-5 p-0.5',
      thumb: 'w-4 h-4',
      translate: 'translate-x-4'
    },
    md: {
      track: 'w-11 h-6 p-0.5',
      thumb: 'w-5 h-5',
      translate: 'translate-x-5'
    },
    lg: {
      track: 'w-14 h-7 p-0.5',
      thumb: 'w-6 h-6',
      translate: 'translate-x-7'
    }
  }[size] || {
    track: 'w-11 h-6 p-0.5',
    thumb: 'w-5 h-5',
    translate: 'translate-x-5'
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-label={ariaLabel || title || (isChecked ? 'Turn Off' : 'Turn On')}
      title={title || ariaLabel || (isChecked ? 'Enabled' : 'Disabled')}
      id={id}
      name={name}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={disabled ? -1 : 0}
      className={`relative inline-flex items-center shrink-0 rounded-full border transition-all duration-200 ease-in-out cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed ${
        sizeConfig.track
      } ${
        isChecked
          ? 'bg-primary border-primary shadow-xs'
          : 'bg-slate-300 hover:bg-slate-350 border-slate-400/90 dark:bg-slate-700 dark:hover:bg-slate-650 dark:border-slate-500 shadow-inner'
      } ${className}`}
      {...props}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block rounded-full bg-white shadow-md border border-black/10 dark:border-white/10 transition-transform duration-200 ease-in-out ${
          sizeConfig.thumb
        } ${isChecked ? sizeConfig.translate : 'translate-x-0'}`}
      />
    </button>
  );
};

export default ToggleSwitch;
