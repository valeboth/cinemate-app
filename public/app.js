// Cinemate frontend — vanilla JS (fără framework în V1).
// Logica de swipe, camere, WebSocket live și solo mode se adaugă în Faza 5.

// Baza API: în dev, Worker-ul rulează pe alt port decât Pages; în prod,
// se configurează un route/proxy. Momentan doar un health-check demonstrativ.
const API_BASE = ""; // TODO(Faza 5): setează în funcție de mediu.

async function main() {
  // Schelet Faza 0 — nimic interactiv încă.
  console.log("Cinemate frontend — schelet Faza 0.");
  void API_BASE;
}

main();
