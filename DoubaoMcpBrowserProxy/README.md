# Cookie Cleaner Chrome Extension

A Chrome extension that automatically clears all cookies before any page loads.

## Features

- Automatically clears all cookies before any webpage loads
- Works on all websites
- Clears cookies when the extension is installed or updated

## Installation

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the directory containing the extension files

## Usage

Once installed, the extension will automatically:
- Clear all cookies before any webpage loads
- Clear cookies when the extension is installed or updated

No additional configuration is needed. The extension works silently in the background.

## Files

- `manifest.json`: Extension configuration
- `background.js`: Main extension logic
- `icon48.png` and `icon128.png`: Extension icons

## Note

This extension requires the following permissions:
- `cookies`: To clear cookies
- `webRequest` and `webRequestBlocking`: To intercept page loads
- `storage`: For extension functionality
- `<all_urls>`: To work on all websites 