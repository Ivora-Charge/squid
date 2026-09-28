import { NextRequest, NextResponse } from "next/server";
import { requireHost, failure } from "@/lib/server/security";
import { ownedProperty } from "@/lib/server/properties";
import { chargerCredentials } from "@/lib/server/charger-credentials";
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const host = await requireHost();
    const { id } = await context.params;
    await ownedProperty(host.id, id);
    return NextResponse.json(await chargerCredentials(id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return failure(error);
  }
}
