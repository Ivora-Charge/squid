import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { demoProperties } from "@/lib/demo";
import { demoAddresses } from "@/lib/onboarding";
import { checked, db, LockBusyError, user } from "@/lib/server/db";
import {
  demoCityPhoto,
  NoCityPhotoError,
  propertyCityPhoto,
} from "@/lib/server/city-photos";
import { failure, HttpError } from "@/lib/server/security";

export const maxDuration = 30;
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    let photo;
    if (request.nextUrl.searchParams.get("demo") === "1") {
      if (!/^[a-zA-Z0-9-]{1,60}$/.test(id))
        throw new HttpError(404, "Charger not found.");
      const city = request.nextUrl.searchParams.get("city");
      const state = request.nextUrl.searchParams.get("state");
      const location = [...demoProperties, ...demoAddresses].find(
        (p) => p.city === city && p.state === state,
      );
      if (!location) throw new HttpError(404, "Charger not found.");
      photo = await demoCityPhoto(id, location.city, location.state);
    } else {
      if (!z.string().uuid().safeParse(id).success)
        throw new HttpError(404, "Charger not found.");
      const property = checked(
        await db()
          .from("squid_properties")
          .select("id,city,state,published,host_id")
          .eq("id", id)
          .maybeSingle(),
      );
      if (
        !property ||
        (!property.published && (await user())?.id !== property.host_id)
      )
        throw new HttpError(404, "Charger not found.");
      photo = await propertyCityPhoto(property);
    }
    return NextResponse.json(
      { photo },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (error) {
    if (error instanceof NoCityPhotoError)
      return NextResponse.json(
        { photo: null },
        { headers: { "Cache-Control": "private, max-age=3600" } },
      );
    if (error instanceof LockBusyError)
      return NextResponse.json(
        { photo: null },
        {
          status: 202,
          headers: { "Retry-After": "1", "Cache-Control": "no-store" },
        },
      );
    return failure(error);
  }
}
