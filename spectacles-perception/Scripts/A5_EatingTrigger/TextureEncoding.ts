/**
 * Promise wrapper around Lens Studio's callback-style Base64 texture
 * encoding, so FoodAnalysisClient can use async/await.
 *
 * TODO(verify): exact global name/signature of the Base64 helper and the
 * CompressionQuality/EncodingType enum members against Lens Studio 5.15.4 —
 * this mirrors the pattern used in Snap's own sample lenses for sending
 * captured frames to a REST backend.
 */
export function encodeTextureToBase64Jpeg(texture: Texture): Promise<string> {
  return new Promise((resolve, reject) => {
    Base64.encodeTextureAsync(
      texture,
      (base64String: string) => resolve(base64String),
      () => reject(new Error('Texture encoding failed')),
      CompressionQuality.HighQuality,
      EncodingType.Jpg
    );
  });
}
