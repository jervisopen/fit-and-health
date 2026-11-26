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

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<DiaryPage />} />
        <Route path="fasting" element={<ComingSoon title="Fasting" module="Module 3" text="Intermittent fasting timer, plans, stages, history and streaks." />} />
        <Route path="snap" element={<ComingSoon title="Snap" module="Module 4" text="Photograph your plate, confirm the detected foods and portions, log in one tap." />} />
        <Route path="foods" element={<MyFoodsPage />} />
        <Route path="me" element={<SettingsPage />} />
      </Route>
      <Route path="add" element={<AddFoodPage />} />
      <Route path="nutrients" element={<NutrientsPage />} />
      <Route path="foods/new" element={<CustomFoodPage />} />
      <Route path="foods/edit/:id" element={<CustomFoodPage />} />
      <Route path="me/goals" element={<GoalsPage />} />
      <Route path="me/meals" element={<MealsPage />} />
      <Route path="*" element={<ComingSoon title="Not found" text="This page doesn't exist." />} />
    </Routes>
  );
}
