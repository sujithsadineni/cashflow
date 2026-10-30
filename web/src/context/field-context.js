import { createContext, useContext } from 'react';

/**
 * True inside a form Field (D231). The Field draws the floating-label box,
 * so the control inside drops its own border and background and sits on
 * the line under the label: text inputs, text areas, the Dropdown and the
 * DatePicker all read this.
 */
export const FieldContext = createContext(false);
export const useInField = () => useContext(FieldContext);
