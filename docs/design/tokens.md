---
version: alpha
name: the project Admin UI
description: Unified UI design specification for the the project admin console, aligned with the admin visual guidelines and implemented semantic tokens.
colors:
  brand: "#2744A5"
  background: "#FFFFFF"
  foreground: "#22222A"
  card: "#FFFFFF"
  card-foreground: "#22222A"
  popover: "#FFFFFF"
  popover-foreground: "#22222A"
  primary: "#2744A5"
  primary-foreground: "#FFFFFF"
  primary-hover: "#1F3A8A"
  primary-light: "#E8F0FF"
  secondary: "#F4F4F5"
  secondary-foreground: "#454554"
  muted: "#F4F4F5"
  muted-foreground: "#71717A"
  accent: "#F4F4F5"
  accent-foreground: "#22222A"
  destructive: "#EF4343"
  destructive-foreground: "#FFFFFF"
  success: "#21C45D"
  success-foreground: "#E9FBF0"
  warning: "#FFA71A"
  warning-foreground: "#FFF5E5"
  info: "#3B82F6"
  inactive: "#64748B"
  experimental: "#7C3AED"
  border: "#E4E4E7"
  input: "#E4E4E7"
  sidebar-background: "#F4F4F5"
  sidebar-foreground: "#71717A"
  sidebar-primary: "#2744A5"
  sidebar-primary-foreground: "#FFFFFF"
  sidebar-accent: "#EAEAEC"
  sidebar-accent-foreground: "#22222A"
  sidebar-border: "#E4E4E7"
  sidebar-ring: "#2744A5"
  dark-background: "#09090B"
  dark-foreground: "#F2F2F2"
  dark-card: "#0E0E11"
  dark-card-foreground: "#F2F2F2"
  dark-secondary: "#242428"
  dark-secondary-foreground: "#CCCCCC"
  dark-muted: "#242428"
  dark-muted-foreground: "#878792"
  dark-primary: "#8AA4FF"
  dark-primary-foreground: "#0F172A"
  dark-accent: "#242428"
  dark-accent-foreground: "#F2F2F2"
  dark-destructive: "#DF3A3A"
  dark-destructive-foreground: "#FFFFFF"
  dark-border: "#2C2C30"
  dark-input: "#2C2C30"
  dark-sidebar-background: "#0E0E11"
  dark-sidebar-foreground: "#878792"
  dark-sidebar-accent: "#1D1D20"
  dark-sidebar-accent-foreground: "#F2F2F2"
  dark-sidebar-border: "#2C2C30"
typography:
  headline-lg:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 30px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.02em
  headline-md:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: -0.02em
  title-md:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.35
  body-md:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  label-md:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
  label-sm:
    fontFamily: ui-sans-serif, system-ui, sans-serif
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.35
  mono-sm:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.5
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  page-padding: 32px
  content-gap: 24px
  card-gap: 16px
  table-min-width: 760px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: 40px
    typography: "{typography.label-md}"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: 40px
    typography: "{typography.label-md}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    height: 40px
    typography: "{typography.label-md}"
  input-default:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 12px
    height: 40px
    typography: "{typography.body-sm}"
  card-default:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.md}"
    typography: "{typography.body-sm}"
  dialog-default:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  badge-success:
    backgroundColor: "{colors.success-foreground}"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
    padding: 8px
    typography: "{typography.label-sm}"
  badge-warning:
    backgroundColor: "{colors.warning-foreground}"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
    padding: 8px
    typography: "{typography.label-sm}"
  badge-destructive:
    backgroundColor: "{colors.destructive-foreground}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.full}"
    padding: 8px
    typography: "{typography.label-sm}"
---

# Design tokens

Canonical semantic token table for Admin UI. Product code should consume these names via CSS/Tailwind, not hard-coded hex in pages.

Narrative color usage rules: see [colors.md](colors.md).
