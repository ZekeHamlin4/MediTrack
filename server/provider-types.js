// Works out MediTrack's provider type (DME, pharmacy, ...) from the NPI registry's main specialty text.
// Used when a company-name search covers all types, so each office shows (and is saved with) its own type.
function typeFromTaxonomy(desc) {
  const d = String(desc || '').toLowerCase();
  if (!d) return 'other';
  if (/durable medical equipment|medical supplies|medical equipment|prosthetic|orthotic|oxygen/.test(d)) return 'dme';
  if (/pharmac/.test(d)) return 'pharmacy';
  if (/home health|home infusion|hospice|nurse|nursing/.test(d)) return 'home_nursing';
  if (/hospital/.test(d)) return 'hospital';
  if (/therap|speech-language|audiolog/.test(d)) return 'therapy';
  if (/^pediatrics$|family medicine|general practice|internal medicine|^pediatrics, general/.test(d)) return 'doctor';
  if (/pediatric|physician|surgery|neurolog|pulmon|cardiol|gastro|otolaryngolog|urolog|orthopa|ophthalm|allerg|endocrin|nephrol|radiolog|anesthes|psychiatr/.test(d)) return 'specialist';
  if (/insurance|health plan/.test(d)) return 'insurance';
  return 'other';
}

module.exports = { typeFromTaxonomy };
