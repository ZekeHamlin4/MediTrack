// Camera barcode scanner for the Scan screen.
// Fix (Nov 18): the camera view used to be drawn only AFTER the scanner started, but the scanner needs
// that view to start, so on iPhone it had nowhere to show the camera. Now the view is always on the page
// (hidden until needed), the scanner starts only after it is shown, and it gets the element through a
// React ref. Its own <video> has playsinline + muted so iPhones show it inline instead of full screen.
(function () {
const { useState, useEffect, useRef } = React;
const READERS = ['code_128_reader', 'ean_reader', 'ean_8_reader', 'code_39_reader', 'upc_reader'];

function CameraScanner({ onCode }) {
  const [state, setState] = useState('idle'); // idle | starting | on
  const [error, setError] = useState('');
  const viewRef = useRef(null);
  const videoRef = useRef(null);
  const run = useRef(0);        // which start this is; an old start finishing late is ignored
  const handler = useRef(null);

  // Stops the scanner and every camera track, so the camera light goes off.
  const stopCamera = () => {
    run.current++;
    try { if (handler.current) Quagga.offDetected(handler.current); } catch (e) {}
    handler.current = null;
    try { Quagga.stop(); } catch (e) {}
    const v = videoRef.current;
    if (v && v.srcObject) { try { v.srcObject.getTracks().forEach(t => t.stop()); } catch (e) {} v.srcObject = null; }
  };
  const stop = () => { stopCamera(); setState('idle'); };

  const start = () => {
    setError('');
    if (!window.isSecureContext) { setError(window.mtCameraErrorMessage(null, false)); return; }
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) { setError(window.mtCameraErrorMessage({ message: 'getUserMedia is not defined' }, true)); return; }
    setState('starting'); // shows the camera view; the effect below starts the scanner once it is on screen
  };

  useEffect(() => {
    if (state !== 'starting') return;
    const mine = ++run.current;
    const target = viewRef.current;
    if (!target) { setError(window.mtCameraErrorMessage({ message: 'camera view missing' }, true)); setState('idle'); return; }
    const fail = err => { stopCamera(); setError(window.mtCameraErrorMessage(err, true)); setState('idle'); };
    try { Quagga.init({
      inputStream: { name: 'Live', type: 'LiveStream', target, constraints: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } },
      decoder: { readers: READERS },
      locate: true,
    }, err => {
      if (mine !== run.current) { try { Quagga.stop(); } catch (e) {} return; } // stopped or left meanwhile
      if (err) return fail(err);
      handler.current = d => {
        const c = d && d.codeResult && d.codeResult.code;
        if (!c) return;
        stopCamera(); setState('idle');
        onCode(c);
      };
      Quagga.onDetected(handler.current);
      Quagga.start();
      setState('on');
    }); } catch (err) { fail(err); } // the scanner can also fail straight away
  }, [state]);

  // Leaving the Scan screen, or the app going to the background: turn the camera off.
  useEffect(() => {
    const onHide = () => { if (document.hidden && run.current) { stopCamera(); setState('idle'); } };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); stopCamera(); };
  }, []);

  // iPhone: the video must be muted and inline before the camera is attached.
  const setVideo = el => {
    videoRef.current = el;
    if (el) { el.muted = true; el.setAttribute('muted', ''); el.setAttribute('playsinline', ''); el.setAttribute('autoplay', ''); }
  };

  const busy = state !== 'idle';
  return (
    <div>
      <button className={'btn ' + (busy ? 'btn-danger' : 'btn-primary')} onClick={busy ? stop : start} style={{ marginBottom: '1rem', fontSize: '16px', padding: '.7rem 1.2rem' }}>
        {state === 'starting' ? 'Starting camera… (tap to stop)' : busy ? 'Stop Camera' : 'Start Camera'}
      </button>
      {error && <div className="alert alert-error" role="alert" style={{ display: 'block' }}>{error}</div>}
      <div className="scanner-wrap cam-view" style={{ display: busy ? 'block' : 'none' }}>
        <div ref={viewRef} className="cam-target"><video ref={setVideo} playsInline muted autoPlay /></div>
        <div className="scanner-overlay" />
      </div>
    </div>
  );
}

Object.assign(window, { CameraScanner });
})();
