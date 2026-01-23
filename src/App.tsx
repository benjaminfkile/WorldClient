import { JSX } from "react";
import WorldScene from "./WorldScene";
import { WorldVersionProvider } from "./WorldVersionContext";
import "./App.css";

export default function App(): JSX.Element {
  return (
    <WorldVersionProvider>
      <div className="App">
        <WorldScene />
      </div>
    </WorldVersionProvider>
  );
}
