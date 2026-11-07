// Service worker (background). Con la mensajeria directa panel<->content, aca
// solo queda abrir el side panel al clickear el icono de la extension.

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[copilot] sidePanel:', err));
