import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function BudgetIntelligence() {
  return (
    <div className="px-8 pb-8 pt-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Budget Intelligence</h1>
        <p className="mt-1 text-base text-muted-foreground">
          Forecast trial spend, identify variance early, and align budget decisions with execution reality.
        </p>
      </div>

      <Card className="max-w-4xl border-border shadow-none">
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide text-muted-foreground">
            Coming soon
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            Budget Intelligence will combine protocol complexity, staffing load, and site-level activity to
            surface burn-rate trends, projected overruns, and decision-ready recommendations for trial
            operations leaders.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
