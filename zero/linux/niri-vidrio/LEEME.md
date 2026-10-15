# niri-vidrio: la refracción del escritorio en el canto de Kitsune Zero

Kitsune no ve lo que hay detrás de su ventana: doblar el escritorio en el canto, como un vidrio de canto
redondo (decisión de Risco, 15-10), solo lo puede hacer quien lo pinta, el compositor. En Linux con niri, este
parche le añade a niri 26.04 la refracción en su efecto de fondo (`background-effect { xray true;
refraction-width 34; refraction-depth 70 }`): el fondo bajo la ventana se lee desplazado en el canto (perfil
de superelipse, Snell n ≈ 1,5, con algo de dispersión por color).

- `0001-refraccion.patch`: el parche, sobre niri 26.04 (8ed0da4).
- `kitsune-zero-vidrio.kdl`: la regla de la refracción para las ventanas de Kitsune.
- `regla.sh poner|quitar`: la incluye o la quita de `kitsune-zero.kdl` (el niri de Arch no la entiende).
- `arrancar.sh`: arranca el niri parcheado; si falta o no acepta la configuración, el de siempre.
- `instalar.sh <niri compilado>` / `instalar.sh --quitar`: lo deja en `~/.local/lib/niri-vidrio` y en el
  servicio `niri.service` (systemd de usuario) para la próxima sesión; no reinicia nada.

Compilar: `git clone https://github.com/YaLTeR/niri && cd niri && git checkout 8ed0da4 &&
git am …/0001-refraccion.patch && cargo build --release`.

En otros sistemas: macOS 26 tiene su propio vidrio (NSGlassEffectView), que lo haría el sistema; en Windows no
hay forma de que una app doble lo que hay detrás. Ahí, y en Linux sin este niri, Zero pone su borde de pompa
(zero-pane), que no necesita ver el escritorio.
