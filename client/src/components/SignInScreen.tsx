import { Shield, Lock, ArrowRight, Activity, FileText, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth0 } from "@/auth/auth0Provider";

interface SignInScreenProps {
  onSignIn: () => void;
}

export function SignInScreen({ onSignIn }: SignInScreenProps) {
  const { loginWithRedirect } = useAuth0();

  const handleSignInClick = async () => {
    onSignIn();
    try {
      await loginWithRedirect();
    } catch {
      // Fallback for local session
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-950">
      <Card className="max-w-md w-full border-border/60 shadow-xl bg-card">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4 text-primary">
            <Lock className="w-6 h-6" />
          </div>
          <CardTitle className="text-2xl font-semibold tracking-tight text-foreground">
            Sign in to Themison
          </CardTitle>
          <CardDescription className="text-sm text-muted-foreground mt-1.5">
            Secure clinical trial workspace & document intelligence platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-4">
          <div className="space-y-3 bg-muted/40 p-4 rounded-lg border border-border/40 text-xs text-muted-foreground">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>Protected Trial Data</span>
            </div>
            <p className="leading-relaxed">
              You are currently signed out. Sign in to access active clinical trials, protocol documents, and AI assistant queries.
            </p>
          </div>

          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              <span>HIPAA & GCP Compliant Access</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              <span>RAG Document Intelligence</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              <span>Role-based Task Management</span>
            </div>
          </div>

          <Button 
            onClick={handleSignInClick} 
            className="w-full h-11 text-sm font-medium gap-2 shadow-sm"
          >
            <span>Sign In to Continue</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
