// AG Studio theme for Instructor analytics. Values point at the dashboard's CSS tokens in
// src/styles.css, so Studio's canvas, widgets, grids and charts match the rest of the page.

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
  textColor: token('ink'),
  foregroundColor: token('ink'),
  subtleTextColor: token('muted'),
  backgroundColor: token('surface'),
  borderColor: token('line'),
  accentColor: token('green'),
  iconColor: token('green'),
  rowHoverColor: token('green-soft'),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: token('canvas'),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: token('canvas'),
  studioCanvasPadding: 4,
  studioCanvasFontFamily: token('font'),

  // Widgets look like the dashboard's cards: white, 1px border, 5px radius.
  studioWidgetBackgroundColor: token('surface'),
  studioWidgetBorder: line('line'),
  studioWidgetBorderRadius: 5,
  studioWidgetPadding: 10,
  studioWidgetTitleFontFamily: token('heading-font'),
  studioWidgetTitleFontSize: 13,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: token('ink'),
  studioWidgetSubtitleFontFamily: token('font'),
  studioWidgetSubtitleTextColor: token('muted'),
  studioWidgetCaptionFontFamily: token('font'),
  studioWidgetCaptionTextColor: token('muted'),
  studioWidgetResizeBorderColor: token('green'),

  studioPanelContainerBackgroundColor: token('surface'),
  studioPanelContainerBorder: line('line'),
  studioPanelDividerColor: token('line'),
  studioPanelDividerActiveColor: token('green'),
  studioPanelSectionBorderColor: token('line'),
  studioPanelHeaderFontFamily: token('heading-font'),
  studioPanelHeaderFontWeight: 700,
  studioPanelChevronButtonHoverBackgroundColor: token('green-soft'),
  studioPanelChevronButtonHoverColor: token('green'),
  studioToggleButtonActiveBackgroundColor: token('green-soft'),
  studioToggleButtonActiveBorderColor: token('green'),
  studioToggleButtonActiveColor: token('green'),

  gridFontFamily: token('font'),
  gridFontSize: 11,
  gridCellTextColor: token('ink'),
  gridHeaderBackgroundColor: token('grid-header'),
  gridHeaderTextColor: token('muted'),
  gridHeaderFontWeight: 700,
  gridHeaderFontSize: 10,
  gridRowHeight: 34,
  gridRowBorder: line('line'),
  gridHeaderRowBorder: line('line'),
  gridRowHoverColor: token('green-soft'),
  gridWrapperBorder: false,

  chartFontFamily: token('font'),
  chartTextColor: token('ink'),
  chartSubtleTextColor: token('muted'),
  chartAxisLineColor: token('line'),
  chartGridLineColor: token('line'),
  ...palette,
});
