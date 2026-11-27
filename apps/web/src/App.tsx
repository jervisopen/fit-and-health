import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell.tsx";
import { Spinner } from "./components/ui.tsx";
import { DiaryPage } from "./features/diary/DiaryPage.tsx";
import { AddFoodPage } from "./features/food/AddFoodPage.tsx";
import { SetupGate } from "./features/setup/SetupGate.tsx";
import { ComingSoon } from "./features/ComingSoon.tsx";

/**
 * The Diary and Add food (the most used screens) load with the app; every other screen is its own
 * chunk, fetched the first time it's opened and warmed in the background once the app is idle.
 * All chunks are precached by the service worker, so this also works offline.
 */
const loaders: (() => Promise<unknown>)[] = [];
function page<T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T) {
  loaders.push(load);
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType })));
}

const FastingPage = page(() => import("./features/fasting/FastingPage.tsx"), "FastingPage");
const SnapPage = page(() => import("./features/snap/SnapPage.tsx"), "SnapPage");
const SnapReviewPage = page(() => import("./features/snap/SnapReviewPage.tsx"), "SnapReviewPage");
const MyFoodsPage = page(() => import("./features/food/MyFoodsPage.tsx"), "MyFoodsPage");
const CustomFoodPage = page(() => import("./features/food/CustomFoodPage.tsx"), "CustomFoodPage");
const NutrientsPage = page(() => import("./features/diary/NutrientsPage.tsx"), "NutrientsPage");
const SettingsPage = page(() => import("./features/settings/SettingsPage.tsx"), "SettingsPage");
const GoalsPage = page(() => import("./features/settings/GoalsPage.tsx"), "GoalsPage");
const MealsPage = page(() => import("./features/settings/MealsPage.tsx"), "MealsPage");
const SnapAiPage = page(() => import("./features/settings/SnapAiPage.tsx"), "SnapAiPage");
const TrackersPage = page(() => import("./features/trackers/TrackersPage.tsx"), "TrackersPage");
const TrackerRoute = page(() => import("./features/trackers/TrackerPage.tsx"), "TrackerRoute");

function useWarmChunks() {
  useEffect(() => {
    const idle = (cb: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 2000));
    idle(() => { for (const l of loaders) void l().catch(() => {}); });
  }, []);
}

const fallback = <div className="flex min-h-[50dvh] items-center justify-center"><Spinner /></div>;

export function App() {
  useWarmChunks();
  return (
    <SetupGate>
      <Suspense fallback={fallback}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DiaryPage />} />
            <Route path="fasting" element={<FastingPage />} />
            <Route path="snap" element={<SnapPage />} />
            <Route path="foods" element={<MyFoodsPage />} />
            <Route path="me" element={<SettingsPage />} />
          </Route>
          <Route path="add" element={<AddFoodPage />} />
          <Route path="nutrients" element={<NutrientsPage />} />
          <Route path="snap/:id" element={<SnapReviewPage />} />
          <Route path="foods/new" element={<CustomFoodPage />} />
          <Route path="foods/edit/:id" element={<CustomFoodPage />} />
          <Route path="me/goals" element={<GoalsPage />} />
          <Route path="me/meals" element={<MealsPage />} />
          <Route path="me/snap-ai" element={<SnapAiPage />} />
          <Route path="trackers" element={<TrackersPage />} />
          <Route path="trackers/:kind" element={<TrackerRoute />} />
          <Route path="*" element={<ComingSoon title="Not found" text="This page doesn't exist." />} />
        </Routes>
      </Suspense>
    </SetupGate>
  );
}
