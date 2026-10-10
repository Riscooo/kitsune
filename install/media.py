"""Bounded, metadata-free decoding of profile photos and home backgrounds."""

from __future__ import annotations

import base64
import binascii
import hashlib
import io
import re
import threading
import warnings

MAX_AVATAR_BYTES = 1536 * 1024
MAX_AVATAR_PIXELS = 16_000_000
MAX_AVATAR_SIDE = 8192
MAX_AVATAR_PNG = 512 * 1024
MAX_BACKGROUND_BYTES = 12 * 1024 * 1024
MAX_BACKGROUND_PIXELS = 50_000_000
MAX_BACKGROUND_SIDE = 12000
BACKGROUND_BOX = (2560, 1600)
MAX_BACKGROUND_JPEG = 4 * 1024 * 1024
_DECODERS = threading.BoundedSemaphore(2)


class InvalidAvatar(ValueError):
    pass


class AvatarUnavailable(OSError):
    pass


def normalize_avatar(value):
    """Return a square 256 px PNG and content hash, never the uploaded original.

    Only still PNG, JPEG and WebP are decoded. SVG, animation, arbitrary MIME
    types, oversized dimensions and excessive decoded pixel counts are rejected.
    A newly allocated RGB/RGBA image strips EXIF, ICC, comments and other metadata.
    """
    if not isinstance(value, str) or len(value) > 2 * 1024 * 1024:
        raise InvalidAvatar("La foto es demasiado grande. Elige una imagen de hasta 1,5 MB.")
    match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})", value)
    if not match:
        raise InvalidAvatar("Elige una foto PNG, JPEG o WebP.")
    try:
        encoded = base64.b64decode(match[2], validate=True)
    except (ValueError, binascii.Error) as error:
        raise InvalidAvatar("No se ha podido leer la foto.") from error
    if not encoded or len(encoded) > MAX_AVATAR_BYTES:
        raise InvalidAvatar("La foto es demasiado grande. Elige una imagen de hasta 1,5 MB.")
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError as error:
        raise AvatarUnavailable("Falta el componente local para procesar fotos.") from error
    with _DECODERS, warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(encoded), formats=("PNG", "JPEG", "WEBP")) as source:
                expected_format = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}[match[1]]
                if source.format != expected_format or getattr(source, "n_frames", 1) != 1:
                    raise InvalidAvatar("Usa una foto estática PNG, JPEG o WebP.")
                width, height = source.size
                if not 1 <= width <= MAX_AVATAR_SIDE or not 1 <= height <= MAX_AVATAR_SIDE or width * height > MAX_AVATAR_PIXELS:
                    raise InvalidAvatar("La foto tiene demasiada resolución. Usa una imagen de hasta 16 megapíxeles.")
                source.load()
                oriented = ImageOps.exif_transpose(source)
                mode = "RGBA" if "A" in oriented.getbands() or "transparency" in oriented.info else "RGB"
                resized = ImageOps.fit(oriented.convert(mode), (256, 256), method=Image.Resampling.LANCZOS)
                clean = Image.new(mode, (256, 256))
                clean.paste(resized)
                output = io.BytesIO()
                clean.save(output, format="PNG", optimize=True)
                png = output.getvalue()
                if len(png) > MAX_AVATAR_PNG:
                    raise InvalidAvatar("No se ha podido reducir la foto al tamaño permitido.")
        except InvalidAvatar:
            raise
        except (OSError, ValueError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise InvalidAvatar("No se ha podido leer esta foto. Elige otra imagen PNG, JPEG o WebP.") from error
    return hashlib.sha256(png).hexdigest(), png


def normalize_background(value):
    """Return a JPEG of at most 2560×1600 px and its content hash, never the original.

    Same rules as profile photos (still PNG, JPEG or WebP; bounded size and
    pixels), with room for a wallpaper. Metadata is dropped and transparency is
    flattened onto black, so only fresh pixels reach the browser.
    """
    if not isinstance(value, str) or len(value) > MAX_BACKGROUND_BYTES * 4 // 3 + 64:
        raise InvalidAvatar("La imagen es demasiado grande. Elige una de hasta 12 MB.")
    match = re.fullmatch(r"data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})", value)
    if not match:
        raise InvalidAvatar("Elige una imagen PNG, JPEG o WebP.")
    try:
        encoded = base64.b64decode(match[2], validate=True)
    except (ValueError, binascii.Error) as error:
        raise InvalidAvatar("No se ha podido leer la imagen.") from error
    if not encoded or len(encoded) > MAX_BACKGROUND_BYTES:
        raise InvalidAvatar("La imagen es demasiado grande. Elige una de hasta 12 MB.")
    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError as error:
        raise AvatarUnavailable("Falta el componente local para procesar imágenes.") from error
    with _DECODERS, warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            with Image.open(io.BytesIO(encoded), formats=("PNG", "JPEG", "WEBP")) as source:
                expected_format = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}[match[1]]
                if source.format != expected_format or getattr(source, "n_frames", 1) != 1:
                    raise InvalidAvatar("Usa una imagen estática PNG, JPEG o WebP.")
                width, height = source.size
                if not 1 <= width <= MAX_BACKGROUND_SIDE or not 1 <= height <= MAX_BACKGROUND_SIDE or width * height > MAX_BACKGROUND_PIXELS:
                    raise InvalidAvatar("La imagen tiene demasiada resolución. Usa una de hasta 50 megapíxeles.")
                source.load()
                oriented = ImageOps.exif_transpose(source)
                rgba = oriented.convert("RGBA")
                rgba.thumbnail(BACKGROUND_BOX, Image.Resampling.LANCZOS)
                clean = Image.new("RGB", rgba.size)
                clean.paste(rgba, mask=rgba.getchannel("A"))
                output = io.BytesIO()
                clean.save(output, format="JPEG", quality=88, optimize=True, progressive=True)
                jpeg = output.getvalue()
                if len(jpeg) > MAX_BACKGROUND_JPEG:
                    raise InvalidAvatar("No se ha podido reducir la imagen al tamaño permitido.")
        except InvalidAvatar:
            raise
        except (OSError, ValueError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
            raise InvalidAvatar("No se ha podido leer esta imagen. Elige otra PNG, JPEG o WebP.") from error
    return hashlib.sha256(jpeg).hexdigest(), jpeg
