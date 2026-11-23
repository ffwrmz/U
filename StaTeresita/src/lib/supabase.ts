// Este archivo contiene la configuración, entendemos que son datos sensibles, sin embargo, es unicamente de prueba
// En caso de quere escalar el proyecto esto se puede adaptar y poner en un archivo .env, para que no se exponga la información sensible.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { configurarClaveSesion, crearFetchOffline } from './offline/fetchOffline';
import 'react-native-url-polyfill/auto'; // necesario en RN

const supabaseUrl = 'https://nyrewlfvgcchjodrqwqp.supabase.co';
const supabaseAnonKey = 'sb_publishable_qbytqJduAkMZQcHEQNOS1w_zTfGr2Dp';

// Modo sin conexión: las lecturas se guardan y las acciones se ponen en cola (lib/offline)
configurarClaveSesion(supabaseUrl);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: crearFetchOffline(supabaseUrl) },
  auth: {
    storage: AsyncStorage,      // persiste la sesión en el dispositivo
    autoRefreshToken: true,     // renueva el token solo
    persistSession: true,        // la sesión queda abierta en el teléfono hasta que se cierre
    detectSessionInUrl: false,  // false en apps móviles
  },
});