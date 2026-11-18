// Tests for the Scan screen's camera messages (client/camera-errors.js) and that the page loads the
// fixed scanner. Run: cd server && npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { cameraErrorMessage } = require('../../client/camera-errors.js');
const CLIENT = path.join(__dirname, '../../client');

test('plain messages for each camera problem', () => {
  const err = (name, message = '') => Object.assign(new Error(message), { name });
  assert.match(cameraErrorMessage(null, false), /only works on the secure MediTrack address.*https:\/\//);
  for (const e of [err('NotAllowedError', 'Permission denied'), err('PermissionDeniedError'), err('SecurityError')]) {
    const m = cameraErrorMessage(e, true);
    assert.match(m, /not allowed to use the camera/);
    assert.match(m, /Settings, Safari, Camera/);
    assert.match(m, /aA/);
  }
  assert.match(cameraErrorMessage(err('NotFoundError', 'Requested device not found'), true), /No camera was found/);
  assert.match(cameraErrorMessage(err('OverconstrainedError'), true), /No camera was found/);
  for (const e of [err('NotReadableError', 'Could not start video source'), err('TrackStartError'), err('AbortError')]) {
    assert.match(cameraErrorMessage(e, true), /being used by another app/);
  }
  assert.match(cameraErrorMessage(new Error('getUserMedia is not defined'), true), /cannot use the camera here/);
  assert.match(cameraErrorMessage('Unable to play video stream. Is webcam working?', true), /showed no picture/);
  assert.match(cameraErrorMessage(err('TypeError', 'something odd'), true), /could not start \(something odd\).*try again/);
  assert.match(cameraErrorMessage(undefined, true), /could not start\. Tap Start Camera/);
});

test('the Scan screen uses the fixed scanner (no camera view looked up by id before it exists)', () => {
  const html = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
  const scanner = fs.readFileSync(path.join(CLIENT, 'scanner.jsx'), 'utf8');
  assert.match(html, /<script src="\/camera-errors\.js"><\/script>/);
  assert.match(html, /src="\/scanner\.jsx"/);
  assert.match(html, /<CameraScanner /);
  assert.doesNotMatch(html, /getElementById\('qvp'\)|Quagga\.init/);
  // The scanner gets its element through a ref, starts only after the view is shown, and asks for the rear camera.
  assert.match(scanner, /target = viewRef\.current/);
  assert.match(scanner, /facingMode: 'environment'/);
  assert.match(scanner, /playsinline/);
  assert.match(scanner, /getTracks\(\)\.forEach\(t => t\.stop\(\)\)/);
  assert.match(scanner, /Quagga\.offDetected/);
});
