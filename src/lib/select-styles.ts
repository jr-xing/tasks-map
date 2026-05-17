import type { GroupBase, StylesConfig } from "react-select";

/**
 * react-select styling mapped onto Obsidian theme variables so dropdowns blend
 * with the active theme. Shared by the task editor panel's selects.
 */
export function obsidianSelectStyles<
  Option,
  IsMulti extends boolean = boolean,
>(): StylesConfig<Option, IsMulti, GroupBase<Option>> {
  return {
    menu: (base) => ({
      ...base,
      zIndex: 9999,
      background: "var(--background-secondary)",
      color: "var(--text-normal)",
      border: "1px solid var(--background-modifier-border)",
    }),
    control: (base, state) => ({
      ...base,
      background: "var(--background-primary)",
      color: "var(--text-normal)",
      borderColor: "var(--background-modifier-border)",
      boxShadow: state.isFocused
        ? "0 0 0 1px var(--interactive-accent)"
        : base.boxShadow,
      "&:hover": { borderColor: "var(--interactive-accent)" },
    }),
    option: (base, state) => ({
      ...base,
      background: state.isFocused
        ? "var(--background-modifier-hover)"
        : "var(--background-secondary)",
      color: "var(--text-normal)",
    }),
    singleValue: (base) => ({ ...base, color: "var(--text-normal)" }),
    multiValue: (base) => ({
      ...base,
      background: "var(--background-modifier-active)",
      color: "var(--text-normal)",
    }),
    multiValueLabel: (base) => ({ ...base, color: "var(--text-normal)" }),
    multiValueRemove: (base) => ({
      ...base,
      color: "var(--text-faint)",
      ":hover": {
        background: "var(--background-modifier-hover)",
        color: "var(--text-normal)",
      },
    }),
    placeholder: (base) => ({ ...base, color: "var(--text-faint)" }),
    input: (base) => ({ ...base, color: "var(--text-normal)" }),
  };
}
