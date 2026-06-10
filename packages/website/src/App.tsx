import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import NotFound from "./pages/NotFound";
import DocsLayout from "./pages/docs/DocsLayout";
import DocsHub from "./pages/docs/DocsHub";
import Install from "./pages/docs/Install";
import Quickstart from "./pages/docs/Quickstart";
import Commands from "./pages/docs/Commands";
import Providers from "./pages/docs/Providers";
import Config from "./pages/docs/Config";
import GithubAction from "./pages/docs/GithubAction";
import Faq from "./pages/docs/Faq";
import ManualTesting from "./pages/docs/ManualTesting";
import Solana from "./pages/docs/Solana";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="docs" element={<DocsLayout />}>
          <Route index element={<DocsHub />} />
          <Route path="install" element={<Install />} />
          <Route path="quickstart" element={<Quickstart />} />
          <Route path="commands" element={<Commands />} />
          <Route path="providers" element={<Providers />} />
          <Route path="config" element={<Config />} />
          <Route path="github-action" element={<GithubAction />} />
          <Route path="faq" element={<Faq />} />
          <Route path="manual-testing" element={<ManualTesting />} />
          <Route path="solana" element={<Solana />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}