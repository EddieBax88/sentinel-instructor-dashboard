// AG Studio theme for Instructor analytics. Values point at the Sentinel Learning brand tokens in
// src/styles.css (Inter for text, Fraunces for titles, --primary for accents), so Studio's canvas,
// widgets, grids and charts match the rest of the dashboard.

import { studioTheme } from 'ag-studio';

const token = (name) => `var(--${name})`;
const line = (color) => ({ width: 1, color: token(color) });

const palette = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, token(`chart-${i + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, token(`chart-${i + 1}`)],
  ]).flat(),
);

export const instructorStudioTheme = studioTheme.withParams({
  fontFamily: token('font'),
  fontSize: 12,
  textColor: token('foreground'),
  foregroundColor: token('foreground'),
  subtleTextColor: token('muted-foreground'),
  backgroundColor: token('card'),
  borderColor: token('border'),
  accentColor: token('primary'),
  iconColor: token('primary'),
  rowHoverColor: token('accent'),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token('background'),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token('background'),
  studioCanvasPadding: 4,
  studioCanvasFontFamily: token('font'),

  // Widgets look like the dashboard's cards: white, 1px border, the brand's small radius.
  studioWidgetBackgroundColor: token('card'),
  studioWidgetBorder: line('border'),
  studioWidgetBorderRadius: 6,
  studioWidgetPadding: 10,
  studioWidgetTitleFontFamily: token('heading-font'),
  studioWidgetTitleFontSize: 13,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: token('foreground'),
  studioWidgetSubtitleFontFamily: token('font'),
  studioWidgetSubtitleTextColor: token('muted-foreground'),
  studioWidgetCaptionFontFamily: token('font'),
  studioWidgetCaptionTextColor: token('muted-foreground'),
  studioWidgetResizeBorderColor: token('primary'),

  studioPanelContainerBackgroundColor: token('card'),
  studioPanelContainerBorder: line('border'),
  studioPanelDividerColor: token('border'),
  studioPanelDividerActiveColor: token('primary'),
  studioPanelSectionBorderColor: token('border'),
  studioPanelHeaderFontFamily: token('heading-font'),
  studioPanelHeaderFontWeight: 700,
  studioPanelChevronButtonHoverBackgroundColor: token('accent'),
  studioPanelChevronButtonHoverColor: token('primary'),
  studioToggleButtonActiveBackgroundColor: token('accent'),
  studioToggleButtonActiveBorderColor: token('primary'),
  studioToggleButtonActiveColor: token('primary'),

  gridFontFamily: token('font'),
  gridFontSize: 11,
  gridCellTextColor: token('foreground'),
  gridHeaderBackgroundColor: token('muted'),
  gridHeaderTextColor: token('muted-foreground'),
  gridHeaderFontWeight: 700,
  gridHeaderFontSize: 10,
  gridRowHeight: 34,
  gridRowBorder: line('border'),
  gridHeaderRowBorder: line('border'),
  gridRowHoverColor: token('accent'),
  gridWrapperBorder: false,

  // Chart colors use the sRGB chart tokens: Studio converts computed colors for AG Charts' canvas
  // only from rgb() or color(srgb), so the oklch brand tokens cannot be used here.
  chartFontFamily: token('font'),
  chartTextColor: token('chart-text'),
  chartSubtleTextColor: token('chart-subtle-text'),
  chartAxisLineColor: token('chart-line'),
  chartGridLineColor: token('chart-line'),
  ...palette,
});
