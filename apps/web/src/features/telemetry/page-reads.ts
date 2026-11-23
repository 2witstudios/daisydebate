import { browserCaptureAttributes } from './browser-capture';
import { requestApp } from '../../lib/page-reads';

/** Browser capture's attributes for this render's `<html>` (ISSUE-1008). */
export const requestBrowserCapture = () =>
  browserCaptureAttributes(requestApp().config);
