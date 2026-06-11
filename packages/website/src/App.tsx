import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { Packs } from "./pages/Packs";
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
import Evm from "./pages/docs/Evm";
import Iac from "./pages/docs/Iac";
import LlmApp from "./pages/docs/LlmApp";
import Move from "./pages/docs/Move";
import Ci from "./pages/docs/Ci";
import Fintech from "./pages/docs/Fintech";
import Web from "./pages/docs/Web";
import Healthcare from "./pages/docs/Healthcare";
import Mobile from "./pages/docs/Mobile";

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="packs" element={<Packs />} />
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
          <Route path="evm" element={<Evm />} />
          <Route path="iac" element={<Iac />} />
          <Route path="llm" element={<LlmApp />} />
          <Route path="move" element={<Move />} />
          <Route path="ci" element={<Ci />} />
          <Route path="fintech" element={<Fintech />} />
          <Route path="web" element={<Web />} />
          <Route path="healthcare" element={<Healthcare />} />
          <Route path="mobile" element={<Mobile />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}