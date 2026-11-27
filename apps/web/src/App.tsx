import { Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell.tsx";
import { DiaryPage } from "./features/diary/DiaryPage.tsx";
import { NutrientsPage } from "./features/diary/NutrientsPage.tsx";
import { AddFoodPage } from "./features/food/AddFoodPage.tsx";
import { CustomFoodPage } from "./features/food/CustomFoodPage.tsx";
import { MyFoodsPage } from "./features/food/MyFoodsPage.tsx";
import { SettingsPage } from "./features/settings/SettingsPage.tsx";
import { GoalsPage } from "./features/settings/GoalsPage.tsx";
import { MealsPage } from "./features/settings/MealsPage.tsx";
import { ComingSoon } from "./features/ComingSoon.tsx";
import { FastingPage } from "./features/fasting/FastingPage.tsx";
import { SnapPage } from "./features/snap/SnapPage.tsx";
import { SnapReviewPage } from "./features/snap/SnapReviewPage.tsx";

export function App() {
  return (
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
      <Route path="*" element={<ComingSoon title="Not found" text="This page doesn't exist." />} />
    </Routes>
  );
}
