import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Ecran affiche quand on arrive sur une etape dont les prerequis manquent. */
export function StepGuard({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="space-y-1.5">
          <p className="font-medium">{title}</p>
          <p className="text-muted-foreground mx-auto max-w-md text-sm text-pretty">
            {description}
          </p>
        </div>
        <Button asChild>
          <Link href={href}>{cta}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
