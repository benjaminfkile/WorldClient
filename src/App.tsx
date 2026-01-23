import { JSX } from "react";
import WorldScene from "./WorldScene";
import { WorldBootstrapProvider } from "./WorldBootstrapContext";
import "./App.css";

export default function App(): JSX.Element {
  return (
    <WorldBootstrapProvider>
      <div className="App">
        <WorldScene />
      </div>
    </WorldBootstrapProvider>
  );
}
