# MereSoft Projects

Flujo implementado:

1. Se crea un proyecto.
2. El proyecto contiene entregables.
3. Los entregables son las tarjetas del tablero.
4. Cada entregable contiene actividades.
5. Al completar todas las actividades se completa el entregable.
6. Al completar todos los entregables se completa el proyecto.
7. Cada proyecto tiene su propio equipo, y ese equipo alimenta los responsables.

MereSoft Projects guarda datos en Firebase Firestore y funciona como PWA.

Marca: MereSoft Suite.
Desarrollado por Hermenegildo Pérez.

Autenticación y roles:

- Firebase Auth usa correo y contraseña.
- Firestore usa `users` para perfiles: `email`, `name`, `role`, `status`.
- Roles disponibles: `admin` y `leader`.
- Estados disponibles: `pending`, `active`, `disabled`.
- Los proyectos guardan `leaderEmail`; Admin ve todos y Líder de Proyecto solo ve los asignados a su correo.
- La primera cuenta se crea como pendiente; se debe activar como Admin una vez desde Firebase Console.


