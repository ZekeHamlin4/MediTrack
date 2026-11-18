// Plain-words messages for camera problems on the Scan screen. Plain JavaScript (no JSX) so it can be
// tested in Node. In the browser it defines window.mtCameraErrorMessage.
(function (root) {
  var HOW_TO_ALLOW =
    'To allow it on iPhone: in Safari, tap the aA (or page settings) button at the left of the address bar, ' +
    'then Website Settings, Camera, Allow. Or open iPhone Settings, Safari, Camera, and choose Ask or Allow. ' +
    'If you use MediTrack from the Home Screen icon, close it (swipe it away) and open it again. Then tap Start Camera.';

  // err: what the browser or the scanner returned. secure: window.isSecureContext.
  function cameraErrorMessage(err, secure) {
    if (secure === false) {
      return 'The camera only works on the secure MediTrack address (the one starting with https:// from Tailscale). ' +
        'On the plain Wi-Fi address (http://…), iPhones block the camera. Open MediTrack from its Tailscale address, ' +
        'or type the barcode below.';
    }
    var name = (err && err.name) || '';
    var text = String((err && err.message) || err || '');
    if (/NotAllowedError|PermissionDeniedError|SecurityError/.test(name) || /permission|denied|not allowed/i.test(text)) {
      return 'MediTrack is not allowed to use the camera. ' + HOW_TO_ALLOW;
    }
    if (/NotFoundError|DevicesNotFoundError|OverconstrainedError/.test(name) || /requested device not found/i.test(text)) {
      return 'No camera was found on this device. You can type the barcode below.';
    }
    if (/NotReadableError|TrackStartError|AbortError/.test(name) || /could not start video source|in use/i.test(text)) {
      return 'The camera is being used by another app (for example a video call or the Camera app). Close that app, then tap Start Camera again.';
    }
    if (/getUserMedia is not defined/i.test(text)) {
      return 'This browser cannot use the camera here. Open MediTrack in Safari from its https:// Tailscale address, or type the barcode below.';
    }
    if (/Unable to play video stream/i.test(text)) {
      return "The camera started but showed no picture. Tap Stop Camera, then Start Camera again. If it keeps happening, close other apps that use the camera.";
    }
    return 'The camera could not start' + (text ? ' (' + text + ')' : '') + '. Tap Start Camera to try again, or type the barcode below.';
  }

  root.mtCameraErrorMessage = cameraErrorMessage;
  if (typeof module !== 'undefined' && module.exports) module.exports = { cameraErrorMessage: cameraErrorMessage };
})(typeof window !== 'undefined' ? window : globalThis);
