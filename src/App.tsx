import { JSX, useState } from "react";
import WorldScene from "./WorldScene";
import "./App.css"

export default function App(): JSX.Element {
  const [coords, setCoords] = useState({ latitude: 46.8721, longitude: -113.994 });

  return (
    <div className="App">
      <WorldScene onCoordsUpdate={setCoords} />
    </div>
  )
}
