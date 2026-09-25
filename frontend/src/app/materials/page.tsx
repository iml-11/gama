import { Suspense } from "react";
import { MaterialsBrowser } from "./materials-browser";

export default function MaterialsPage() {
  return (
    <Suspense>
      <MaterialsBrowser />
    </Suspense>
  );
}
