// AG Studio theme for Instructor analytics. Values point at the Sentinel Learning brand tokens in
// src/theme-tokens.css (Inter for text, Fraunces for titles, --primary for accents), so Studio's
// canvas, widgets, grids and charts match the rest of the dashboard and follow the theme switch:
// Studio re-reads every token when its style sensor sees the foreground/background change.

import { studioTheme } from 'ag-studio';

// Colour params use the --srgb-* hex twins of the brand tokens (src/theme/themes.js): Studio resolves
// theme colours in JavaScript and converts only rgb() or color(srgb), so an oklch token would fall
// back to Studio's default (white widgets, dark text) in the dark themes. Non-colour params use the
// plain tokens.
const token = (name) => `var(--${name})`;
const srgb = (name) => `var(--srgb-${name})`;
const line = (color) => ({ width: 1, color: srgb(color) });

const palette = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, token(`chart-${i + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, token(`chart-${i + 1}`)],
  ]).flat(),
);

export const instructorStudioTheme = studioTheme.withParams({
  fontFamily: token('font'),
  fontSize: 12,
  textColor: srgb('foreground'),
  foregroundColor: srgb('foreground'),
  subtleTextColor: srgb('muted-foreground'),
  backgroundColor: srgb('card'),
  borderColor: srgb('border'),
  accentColor: srgb('primary'),
  iconColor: srgb('primary'),
  rowHoverColor: srgb('accent-soft'),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: srgb('background'),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: srgb('background'),
  studioCanvasPadding: 4,
  studioCanvasFontFamily: token('font'),

  // Widgets look like the dashboard's cards: white, 1px border, the brand's small radius.
  studioWidgetBackgroundColor: srgb('card'),
  studioWidgetBorder: line('border'),
  studioWidgetBorderRadius: 6,
  studioWidgetPadding: 10,
  studioWidgetTitleFontFamily: token('heading-font'),
  studioWidgetTitleFontSize: 13,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: srgb('foreground'),
  studioWidgetSubtitleFontFamily: token('font'),
  studioWidgetSubtitleTextColor: srgb('muted-foreground'),
  studioWidgetCaptionFontFamily: token('font'),
  studioWidgetCaptionTextColor: srgb('muted-foreground'),
  studioWidgetResizeBorderColor: srgb('primary'),

  studioPanelContainerBackgroundColor: srgb('card'),
  studioPanelContainerBorder: line('border'),
  studioPanelDividerColor: srgb('border'),
  studioPanelDividerActiveColor: srgb('primary'),
  studioPanelSectionBorderColor: srgb('border'),
  studioPanelHeaderFontFamily: token('heading-font'),
  studioPanelHeaderFontWeight: 700,
  studioPanelChevronButtonHoverBackgroundColor: srgb('accent-soft'),
  studioPanelChevronButtonHoverColor: srgb('primary'),
  studioToggleButtonActiveBackgroundColor: srgb('accent-soft'),
  studioToggleButtonActiveBorderColor: srgb('primary'),
  studioToggleButtonActiveColor: srgb('primary'),

  gridFontFamily: token('font'),
  gridFontSize: 11,
  gridCellTextColor: srgb('foreground'),
  gridHeaderBackgroundColor: srgb('muted'),
  gridHeaderTextColor: srgb('muted-foreground'),
  gridHeaderFontWeight: 700,
  gridHeaderFontSize: 10,
  gridRowHeight: 34,
  gridRowBorder: line('border'),
  gridHeaderRowBorder: line('border'),
  gridRowHoverColor: srgb('accent-soft'),
  gridWrapperBorder: false,

  // Chart text and lines use the sRGB chart tokens for the same reason.
  chartFontFamily: token('font'),
  chartTextColor: token('chart-text'),
  chartSubtleTextColor: token('chart-subtle-text'),
  chartAxisLineColor: token('chart-line'),
  chartGridLineColor: token('chart-line'),
  ...palette,
});
