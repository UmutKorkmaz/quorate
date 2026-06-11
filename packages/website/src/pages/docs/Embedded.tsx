import { PackDocTemplate } from "../../components/PackDocTemplate";
import { PACK_DOC_DATA } from "../../lib/pack-docs";

export default function Embedded() {
  return <PackDocTemplate data={PACK_DOC_DATA["embedded"]} />;
}
