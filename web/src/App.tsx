// SPDX-License-Identifier: Apache-2.0
import { lazy, Suspense } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { Logo } from './components/Logo';
import { REPO_URL } from './config';
import Landing from './routes/Landing';

// The demo and the ledger load the contract runtime (WebAssembly); the landing page does not.
const Demo = lazy(() => import('./routes/Demo'));
const LedgerPage = lazy(() => import('./routes/Ledger'));
// Live mode also loads the wallet, proof and contract-deployment stack.
const LivePage = lazy(() => import('./routes/Live'));

function Loading() {
  return (
    <div className="wrap page">
      <div className="busy-line">
        <span className="spinner" /> Loading the contract runtime…
      </div>
    </div>
  );
}

export default function App() {
  return (
    <>
      <header className="nav">
        <div className="wrap">
          <NavLink to="/" className="brand" end>
            <Logo />
            Ampoule
          </NavLink>
          <nav className="nav-links">
            <NavLink to="/demo">Demo</NavLink>
            <NavLink to="/ledger">On chain</NavLink>
            <NavLink to="/live">Live</NavLink>
            {REPO_URL && (
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                Code
              </a>
            )}
          </nav>
          <NavLink to="/ledger" className="net-badge">
            <span className="dot" /> Midnight Preview
          </NavLink>
        </div>
      </header>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/demo/:chapter" element={<Demo />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/live" element={<LivePage />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </Suspense>
      <footer className="foot">
        <div className="wrap">
          <span>Ampoule. Apache-2.0. Built for the Midnight wave hack on AKINDO.</span>
          <span>All people, clinics and pharmacies here are fictional. Testnet only.</span>
        </div>
      </footer>
    </>
  );
}
