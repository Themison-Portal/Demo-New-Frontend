/**
 * Notifications Page
 * Design: Clinical Modernism
 */

import { Bell } from "lucide-react";

export default function Notifications() {
  return (
    <div className="p-8">
      <div className="flex items-center gap-3 mb-6">
        <Bell className="h-8 w-8 text-primary" />
        <h1 className="text-3xl font-bold text-foreground tracking-tight">
          Notifications
        </h1>
      </div>
      <p className="text-muted-foreground">
        Stay updated on trial activities, tasks, and team communications.
      </p>
    </div>
  );
}
