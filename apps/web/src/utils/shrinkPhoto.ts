/** Longest side of a photo after shrinking; enough to see a dent or a tyre. */
const MAX_SIDE = 1600;
const QUALITY = 0.82;

/**
 * A phone photo is several MB; the server keeps at most 1.5 MB. The browser
 * draws it at most 1600 px wide (turned the way the camera held it) and sends
 * a JPEG of a few hundred KB.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        throw new Error("Das Foto lässt sich nicht verkleinern.");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error("Das Foto lässt sich nicht verkleinern."))),
            "image/jpeg",
            QUALITY,
        );
    });
}
