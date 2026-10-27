import React, { useState, useEffect } from 'react';
import {
  Type,
  FileText,
  Mail,
  Phone,
  Hash,
  Calendar,
  Clock,
  ChevronDown,
  ListFilter,
  CheckSquare,
  Radio as RadioIcon,
  Upload,
  Image as ImageIcon,
  Link,
  Lock,
  Palette,
  Star,
  ToggleLeft,
  AlertCircle
} from 'lucide-react';
import ToggleSwitch from './ToggleSwitch';

/**
 * Universal Dynamic Form Field Renderer
 * Renders 19 FieldType options, evaluates role-based visibility/editability,
 * handles conditional visibility (dependsOnField / dependsOnOperator / dependsOnValue),
 * and enforces dynamic validation rules (Regex, Min/Max length, Min/Max value).
 */
export const UniversalDynamicRenderer = ({
  fields = [],
  formData = {},
  onChange,
  userRole = 'INTERN',
  readOnly = false,
  errors = {}
}) => {
  const [localErrors, setLocalErrors] = useState({});

  // Evaluate conditional visibility for a field based on current formData
  const isFieldConditionallyVisible = (field) => {
    if (!field.dependsOnField) return true;

    const parentVal = formData[field.dependsOnField];
    const targetVal = field.dependsOnValue;
    const operator = field.dependsOnOperator || 'EQUALS';

    if (parentVal === undefined || parentVal === null || parentVal === '') {
      return operator === 'IS_EMPTY';
    }

    switch (operator) {
      case 'EQUALS':
        return String(parentVal).toLowerCase() === String(targetVal).toLowerCase();
      case 'NOT_EQUALS':
        return String(parentVal).toLowerCase() !== String(targetVal).toLowerCase();
      case 'CONTAINS':
        return String(parentVal).toLowerCase().includes(String(targetVal).toLowerCase());
      case 'GREATER_THAN':
        return Number(parentVal) > Number(targetVal);
      case 'LESS_THAN':
        return Number(parentVal) < Number(targetVal);
      case 'IN':
        return targetVal.split(',').map(s => s.trim().toLowerCase()).includes(String(parentVal).toLowerCase());
      case 'IS_NOT_EMPTY':
        return String(parentVal).trim() !== '';
      default:
        return true;
    }
  };

  // Evaluate role-based visibility
  const isFieldVisibleForRole = (field) => {
    if (field.isHidden) return false;
    if (!field.visibleTo || field.visibleTo.includes('ALL')) return true;
    return field.visibleTo.includes(userRole);
  };

  // Evaluate role-based editability
  const isFieldEditableForRole = (field) => {
    if (readOnly || field.isReadOnly || field.isDisabled) return false;
    if (!field.editableBy || field.editableBy.includes('ALL')) return true;
    return field.editableBy.includes(userRole);
  };

  // Evaluate role-based required status
  const isFieldRequiredForRole = (field) => {
    if (!field.requiredFor) return false;
    if (field.requiredFor.includes('ALL')) return true;
    return field.requiredFor.includes(userRole);
  };

  // Handle Input Changes & Internal Validation
  const handleInputChange = (fieldKey, value, field) => {
    let errorMsg = '';

    // Validation: Regex Pattern
    if (value && field.regexPattern) {
      try {
        const regex = new RegExp(field.regexPattern);
        if (!regex.test(value)) {
          errorMsg = `Does not match expected format (${field.regexPattern})`;
        }
      } catch (err) {
        // Invalid regex ignore
      }
    }

    // Validation: Min/Max Length
    if (value && typeof value === 'string') {
      if (field.minLength && value.length < field.minLength) {
        errorMsg = `Minimum ${field.minLength} characters required.`;
      }
      if (field.maxLength && value.length > field.maxLength) {
        errorMsg = `Maximum ${field.maxLength} characters allowed.`;
      }
    }

    // Validation: Min/Max Values for Numbers
    if (value !== '' && field.fieldType === 'NUMBER') {
      const num = Number(value);
      if (field.minVal !== null && field.minVal !== undefined && num < field.minVal) {
        errorMsg = `Minimum value allowed is ${field.minVal}.`;
      }
      if (field.maxVal !== null && field.maxVal !== undefined && num > field.maxVal) {
        errorMsg = `Maximum value allowed is ${field.maxVal}.`;
      }
    }

    setLocalErrors(prev => ({ ...prev, [fieldKey]: errorMsg }));
    if (onChange) {
      onChange(fieldKey, value);
    }
  };

  const getFieldIcon = (fieldType) => {
    switch (fieldType) {
      case 'EMAIL': return <Mail className="h-4 w-4 text-muted-foreground" />;
      case 'PHONE': return <Phone className="h-4 w-4 text-muted-foreground" />;
      case 'NUMBER': return <Hash className="h-4 w-4 text-muted-foreground" />;
      case 'DATE': return <Calendar className="h-4 w-4 text-muted-foreground" />;
      case 'TIME': return <Clock className="h-4 w-4 text-muted-foreground" />;
      case 'DATETIME': return <Calendar className="h-4 w-4 text-muted-foreground" />;
      case 'TEXTAREA': return <FileText className="h-4 w-4 text-muted-foreground" />;
      case 'DROPDOWN': return <ChevronDown className="h-4 w-4 text-muted-foreground" />;
      case 'MULTISELECT': return <ListFilter className="h-4 w-4 text-muted-foreground" />;
      case 'CHECKBOX': return <CheckSquare className="h-4 w-4 text-muted-foreground" />;
      case 'RADIO': return <RadioIcon className="h-4 w-4 text-muted-foreground" />;
      case 'FILE': return <Upload className="h-4 w-4 text-muted-foreground" />;
      case 'IMAGE': return <ImageIcon className="h-4 w-4 text-muted-foreground" />;
      case 'URL': return <Link className="h-4 w-4 text-muted-foreground" />;
      case 'PASSWORD': return <Lock className="h-4 w-4 text-muted-foreground" />;
      case 'COLOR': return <Palette className="h-4 w-4 text-muted-foreground" />;
      case 'RATING': return <Star className="h-4 w-4 text-amber-500 fill-amber-500" />;
      case 'SWITCH': return <ToggleLeft className="h-4 w-4 text-muted-foreground" />;
      default: return <Type className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const visibleFields = fields.filter(f => isFieldVisibleForRole(f) && isFieldConditionallyVisible(f));

  if (visibleFields.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-muted-foreground bg-muted/20 rounded-xl border border-dashed border-border">
        No form fields configured or visible for your role.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {visibleFields.map(field => {
        const value = formData[field.fieldKey] !== undefined ? formData[field.fieldKey] : (field.defaultValue || '');
        const editable = isFieldEditableForRole(field);
        const required = isFieldRequiredForRole(field);
        const error = errors[field.fieldKey] || localErrors[field.fieldKey];

        const parsedOptions = Array.isArray(field.options)
          ? field.options
          : (typeof field.options === 'string' ? field.options.split(',').map(s => s.trim()) : []);

        return (
          <div key={field.fieldKey} className="space-y-1.5">
            <label className="flex items-center justify-between text-xs font-semibold text-foreground uppercase tracking-wider">
              <span className="flex items-center gap-1.5">
                {getFieldIcon(field.fieldType)}
                <span>{field.label}</span>
                {required && <span className="text-danger">*</span>}
              </span>
              {field.isSystemDefault && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground rounded">
                  System Default
                </span>
              )}
            </label>

            {/* Input Element Rendering by FieldType */}
            <div className="relative">
              {field.fieldType === 'TEXTAREA' ? (
                <textarea
                  value={value}
                  disabled={!editable}
                  placeholder={field.placeholder || ''}
                  onChange={e => handleInputChange(field.fieldKey, e.target.value, field)}
                  rows={3}
                  className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    !editable ? 'opacity-60 cursor-not-allowed bg-muted/40' : ''
                  } ${error ? 'border-danger focus:ring-danger/20' : 'border-border'}`}
                />
              ) : field.fieldType === 'DROPDOWN' ? (
                <select
                  value={value}
                  disabled={!editable}
                  onChange={e => handleInputChange(field.fieldKey, e.target.value, field)}
                  className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    !editable ? 'opacity-60 cursor-not-allowed bg-muted/40' : ''
                  } ${error ? 'border-danger focus:ring-danger/20' : 'border-border'}`}
                >
                  <option value="">{field.placeholder || '-- Select Option --'}</option>
                  {parsedOptions.map((opt, i) => (
                    <option key={i} value={opt}>{opt}</option>
                  ))}
                </select>
              ) : field.fieldType === 'RADIO' ? (
                <div className="flex flex-wrap gap-4 pt-1">
                  {parsedOptions.map((opt, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                      <input
                        type="radio"
                        name={field.fieldKey}
                        value={opt}
                        checked={value === opt}
                        disabled={!editable}
                        onChange={e => handleInputChange(field.fieldKey, e.target.value, field)}
                        className="h-4 w-4 text-primary focus:ring-primary"
                      />
                      <span>{opt}</span>
                    </label>
                  ))}
                </div>
              ) : field.fieldType === 'CHECKBOX' ? (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id={field.fieldKey}
                    checked={!!value}
                    disabled={!editable}
                    onChange={e => handleInputChange(field.fieldKey, e.target.checked, field)}
                    className="h-4 w-4 rounded text-primary focus:ring-primary"
                  />
                  <label htmlFor={field.fieldKey} className="text-sm font-medium text-foreground cursor-pointer">
                    {field.placeholder || field.label}
                  </label>
                </div>
              ) : field.fieldType === 'SWITCH' ? (
                <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/20">
                  <span className="text-sm font-medium text-foreground">{field.placeholder || field.label}</span>
                  <ToggleSwitch
                    id={field.fieldKey}
                    name={field.fieldKey}
                    ariaLabel={field.placeholder || field.label}
                    disabled={!editable}
                    checked={Boolean(value)}
                    onChange={(nextVal) => handleInputChange(field.fieldKey, nextVal, field)}
                  />
                </div>
              ) : field.fieldType === 'RATING' ? (
                <div className="flex items-center gap-1 pt-1">
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      disabled={!editable}
                      onClick={() => handleInputChange(field.fieldKey, star, field)}
                      className="p-1 hover:scale-110 transition-transform disabled:cursor-not-allowed"
                    >
                      <Star className={`h-6 w-6 ${
                        Number(value) >= star ? 'text-amber-500 fill-amber-500' : 'text-muted-foreground/40'
                      }`} />
                    </button>
                  ))}
                </div>
              ) : field.fieldType === 'COLOR' ? (
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={value || '#057a55'}
                    disabled={!editable}
                    onChange={e => handleInputChange(field.fieldKey, e.target.value, field)}
                    className="h-9 w-12 rounded border border-border cursor-pointer"
                  />
                  <span className="text-xs font-mono text-muted-foreground">{value || '#057a55'}</span>
                </div>
              ) : (
                <input
                  type={
                    field.fieldType === 'EMAIL' ? 'email' :
                    field.fieldType === 'NUMBER' ? 'number' :
                    field.fieldType === 'DATE' ? 'date' :
                    field.fieldType === 'TIME' ? 'time' :
                    field.fieldType === 'DATETIME' ? 'datetime-local' :
                    field.fieldType === 'PASSWORD' ? 'password' :
                    field.fieldType === 'URL' ? 'url' : 'text'
                  }
                  value={value}
                  disabled={!editable}
                  placeholder={field.placeholder || ''}
                  onChange={e => handleInputChange(field.fieldKey, e.target.value, field)}
                  className={`w-full rounded-lg border bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 ${
                    !editable ? 'opacity-60 cursor-not-allowed bg-muted/40' : ''
                  } ${error ? 'border-danger focus:ring-danger/20' : 'border-border'}`}
                />
              )}
            </div>

            {/* Field Helper / Validation Error Message */}
            {error ? (
              <p className="flex items-center gap-1 text-xs text-danger font-medium mt-1">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>{error}</span>
              </p>
            ) : field.placeholder && field.fieldType !== 'TEXTAREA' && field.fieldType !== 'DROPDOWN' ? (
              <p className="text-[11px] text-muted-foreground">{field.placeholder}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default UniversalDynamicRenderer;
