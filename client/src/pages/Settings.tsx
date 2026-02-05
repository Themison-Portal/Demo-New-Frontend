/**
 * Settings Page
 * Design: Clinical Modernism
 */

import { Settings as SettingsIcon } from "lucide-react";

export default function Settings() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <SettingsIcon className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Settings
        </h1>
      </div>
      <p className="text-muted-foreground">
        Configure your account preferences, notifications, and system settings.
      </p>
    </div>
  );
}
