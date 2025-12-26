import "./App.css";
import { StudyDeck } from "./components/StudyDeck";

function App() {
  return (
    <div className="app-container">
      <header className="app-header">
        <h1>Study Deck</h1>
      </header>

      <main className="app-main">
        <StudyDeck />
      </main>
    </div>
  );
}

export default App;
