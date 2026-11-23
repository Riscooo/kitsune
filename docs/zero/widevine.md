# Pedir la licencia de Widevine

Es lo único que haría sonar Spotify sin su app, y lo que piden otras webs de vídeo. La da Google a cada navegador, con la firma de sus
programas (VMP). Zen la pidió y tardó meses; Floorp y Waterfox tienen el mismo problema.

Google dice que para otros acuerdos se escriba a **widevine@google.com** y que el acceso va por el *Widevine Master License Agreement*,
con una cuenta de Google hecha con un correo de empresa ([developers.google.com/widevine/access](https://developers.google.com/widevine/access)).
No he encontrado un formulario propio para navegadores. Lo tiene que mandar y firmar el autor de Kitsune.

## Borrador del correo

> **Subject:** Widevine CDM license request for a Gecko-based desktop browser (Kitsune)
>
> Hello,
>
> I develop Kitsune, a free desktop browser for Windows, macOS and Linux built from Mozilla's official Gecko source code
> (https://github.com/Riscooo/kitsune, https://kitsune-navegador.vercel.app). It downloads the Widevine CDM through Gecko's own media plugin
> manager, unmodified, but our binaries are not VMP-signed, so services that require a verified media path refuse playback on Windows and
> macOS.
>
> I would like to apply for the license agreement and the VMP signing certificate needed to ship Kitsune with verified Widevine support.
> We do not modify or redistribute the CDM, and we will follow the security and update requirements of the agreement.
>
> Could you tell me the process, the documents you need and any fees?
>
> Thank you,
> [nombre y datos de contacto]

Cuando la haya: las firmas (`kitsune.exe.sig`, `plugin-container.exe.sig`, `xul.dll.sig`) van junto a los programas al compilar, y
`zero-spotify` se apaga solo al ver `kitsune.exe.sig`.
