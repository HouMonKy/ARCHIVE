import { getPrismaClientAsync } from "@/lib/prisma"
import { requireApiUser } from "@/lib/auth/guard"
import { createRecognitionJob } from "@/lib/services/recognition"
import { demoNow } from "@/lib/clock"
import { AppError } from "@/lib/errors"
import { toErrorResponse } from "@/lib/errors"

export async function POST(request: Request) {
  try {
    const user = await requireApiUser(await getPrismaClientAsync(), request, {
      demoQuota: "RECOGNITION",
      now: demoNow(),
    })
    const db = await getPrismaClientAsync()
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File)) {
      throw new AppError("缺少上传文件（字段名 file）", { status: 400, code: "NO_FILE" })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    const dto = await createRecognitionJob(
      db,
      user.id,
      { name: file.name, mimeType: file.type, bytes },
      { role: user.role, userRotation: form.get("rotate") },
    )
    return Response.json(dto)
  } catch (e) {
    const { status, body } = toErrorResponse(e)
    return Response.json(body, { status })
  }
}
