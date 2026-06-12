import { useEffect, useRef, useState } from 'react'
import './App.css'
import { supabase } from './lib/supabase'

type NumberStatus = 'livre' | 'reservado' | 'pago'

type RaffleNumber = {
  id: number
  label: string
  status: NumberStatus
  reservedByName?: string
  reservedByWhatsApp?: string
}

type ConfirmedReservation = {
  selectedNumberLabels: string[]
  fullName: string
  whatsApp: string
  total: number
}

type DrawWinner = {
  prize: string
  numberLabel: string
  fullName: string
  whatsApp: string
}

type SupabaseRaffleNumberRow = {
  id: number
  label: string
  status: string
  reserved_by_name: string | null
  reserved_by_whatsapp: string | null
}

type SupabaseDrawWinnerRow = {
  id: number
  prize: string
  number_label: string
  full_name: string
  whatsapp: string
  created_at: string
}

const ticketPrice = 10
const totalRaffleNumbers = 500
const totalPrizes = 6
const lastConfirmedReservationStorageKey = 'lastConfirmedReservation'
const raffleOwnerWhatsApp = '63984773055'
const adminPassword = '10112001'

const prizeLabels = [
  '1º prêmio',
  '2º prêmio',
  '3º prêmio',
  '4º prêmio',
  '5º prêmio',
  '6º prêmio',
] as const

const initialRaffleNumbers: RaffleNumber[] = Array.from(
  { length: totalRaffleNumbers },
  (_, index) => {
    const id = index + 1

    return {
      id,
      label: String(id).padStart(3, '0'),
      status: 'livre' as const,
    }
  },
)

const filterOptions = [
  { label: 'Todos', value: 'todos' },
  { label: 'Livres', value: 'livre' },
  { label: 'Reservados', value: 'reservado' },
  { label: 'Pagos', value: 'pago' },
] as const

function isValidNumberStatus(value: unknown): value is NumberStatus {
  return value === 'livre' || value === 'reservado' || value === 'pago'
}

function isValidDrawWinner(value: unknown): value is DrawWinner {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.prize === 'string' &&
    typeof candidate.numberLabel === 'string' &&
    typeof candidate.fullName === 'string' &&
    typeof candidate.whatsApp === 'string'
  )
}

function isValidConfirmedReservation(
  value: unknown,
): value is ConfirmedReservation {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    Array.isArray(candidate.selectedNumberLabels) &&
    candidate.selectedNumberLabels.every((item) => typeof item === 'string') &&
    typeof candidate.fullName === 'string' &&
    typeof candidate.whatsApp === 'string' &&
    typeof candidate.total === 'number'
  )
}

function loadStoredLastConfirmedReservation() {
  const storedValue = window.localStorage.getItem(
    lastConfirmedReservationStorageKey,
  )

  if (!storedValue) {
    return null
  }

  try {
    const parsedValue: unknown = JSON.parse(storedValue)

    if (isValidConfirmedReservation(parsedValue)) {
      return parsedValue
    }
  } catch {
    return null
  }

  return null
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function normalizeWhatsApp(value: string) {
  const digitsOnly = value.replace(/\D/g, '')

  if (digitsOnly.startsWith('55') && digitsOnly.length > 11) {
    return digitsOnly.slice(2)
  }

  return digitsOnly
}

function mapSupabaseRaffleNumberRow(row: SupabaseRaffleNumberRow) {
  if (!isValidNumberStatus(row.status)) {
    return null
  }

  return {
    id: row.id,
    label: row.label,
    status: row.status,
    reservedByName: row.reserved_by_name ?? undefined,
    reservedByWhatsApp: row.reserved_by_whatsapp ?? undefined,
  } satisfies RaffleNumber
}

function mapSupabaseDrawWinnerRow(row: SupabaseDrawWinnerRow) {
  const mappedRow = {
    prize: row.prize,
    numberLabel: row.number_label,
    fullName: row.full_name,
    whatsApp: row.whatsapp,
  } satisfies DrawWinner

  if (!isValidDrawWinner(mappedRow)) {
    return null
  }

  return mappedRow
}

function buildWhatsAppLink(reservation: ConfirmedReservation) {
  const message = [
    'Olá! Quero enviar minha reserva da rifa.',
    '',
    `Nome: ${reservation.fullName}`,
    `WhatsApp: ${reservation.whatsApp}`,
    `Números: ${reservation.selectedNumberLabels.join(', ')}`,
    `Total: ${formatCurrency(reservation.total)}`,
  ].join('\n')

  return `https://wa.me/${raffleOwnerWhatsApp}?text=${encodeURIComponent(message)}`
}

function App() {
  const reservationSummaryRef = useRef<HTMLDivElement | null>(null)
  const isAdminMode = window.location.search.includes('admin=1')
  const [raffleNumbers, setRaffleNumbers] =
    useState<RaffleNumber[]>(initialRaffleNumbers)
  const [raffleNumbersError, setRaffleNumbersError] = useState('')
  const [activeFilter, setActiveFilter] =
    useState<(typeof filterOptions)[number]['value']>('todos')
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([])
  const [showReservationForm, setShowReservationForm] = useState(false)
  const [fullName, setFullName] = useState('')
  const [whatsApp, setWhatsApp] = useState('')
  const [reservationError, setReservationError] = useState('')
  const [lastReservation, setLastReservation] =
    useState<ConfirmedReservation | null>(loadStoredLastConfirmedReservation)
  const [adminPasswordInput, setAdminPasswordInput] = useState('')
  const [adminUnlocked, setAdminUnlocked] = useState(false)
  const [adminError, setAdminError] = useState('')
  const [adminActionError, setAdminActionError] = useState('')
  const [drawResult, setDrawResult] = useState<DrawWinner[] | null>(null)
  const [drawError, setDrawError] = useState('')
  const isAdminView = isAdminMode && adminUnlocked

  useEffect(() => {
    let isMounted = true

    async function fetchRaffleNumbers() {
      setRaffleNumbersError('')

      const { data, error } = await supabase
        .from('raffle_numbers')
        .select('id, label, status, reserved_by_name, reserved_by_whatsapp')
        .order('id', { ascending: true })

      if (!isMounted) {
        return
      }

      if (error) {
        setRaffleNumbersError('Não foi possível carregar os números online.')
        return
      }

      const rows = (data ?? []) as SupabaseRaffleNumberRow[]
      const mappedNumbers = rows.flatMap((row) => {
        const mappedRow = mapSupabaseRaffleNumberRow(row)
        return mappedRow ? [mappedRow] : []
      })

      if (mappedNumbers.length !== totalRaffleNumbers) {
        setRaffleNumbersError('A base online de números está incompleta.')
        return
      }

      setRaffleNumbers(mappedNumbers)
    }

    void fetchRaffleNumbers()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    const channel = supabase
      .channel('raffle_numbers_realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'raffle_numbers',
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const deletedRow = payload.old as Partial<SupabaseRaffleNumberRow>

            if (typeof deletedRow.id !== 'number') {
              return
            }

            setRaffleNumbers((current) =>
              current.filter((number) => number.id !== deletedRow.id),
            )
            return
          }

          const nextRow = payload.new as SupabaseRaffleNumberRow
          const mappedRow = mapSupabaseRaffleNumberRow(nextRow)

          if (!mappedRow) {
            return
          }

          setRaffleNumbers((current) => {
            const existingIndex = current.findIndex(
              (number) => number.id === mappedRow.id,
            )

            if (existingIndex === -1) {
              return [...current, mappedRow].sort((a, b) => a.id - b.id)
            }

            const nextNumbers = [...current]
            nextNumbers[existingIndex] = mappedRow
            nextNumbers.sort((a, b) => a.id - b.id)
            return nextNumbers
          })
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    let isMounted = true

    async function fetchDrawResult() {
      const { data, error } = await supabase
        .from('raffle_draw_results')
        .select('id, prize, number_label, full_name, whatsapp, created_at')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })

      if (!isMounted) {
        return
      }

      if (error) {
        setDrawError('Não foi possível carregar o resultado do sorteio.')
        return
      }

      const rows = (data ?? []) as SupabaseDrawWinnerRow[]

      if (rows.length === 0) {
        setDrawResult(null)
        return
      }

      const mappedResult = rows.flatMap((row) => {
        const mappedRow = mapSupabaseDrawWinnerRow(row)
        return mappedRow ? [mappedRow] : []
      })

      if (mappedResult.length !== rows.length) {
        setDrawError('Resultado do sorteio salvo está inválido.')
        return
      }

      setDrawResult(mappedResult)
    }

    void fetchDrawResult()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!lastReservation) {
      window.localStorage.removeItem(lastConfirmedReservationStorageKey)
      return
    }

    window.localStorage.setItem(
      lastConfirmedReservationStorageKey,
      JSON.stringify(lastReservation),
    )
  }, [lastReservation])

  const visibleNumbers =
    activeFilter === 'todos'
      ? raffleNumbers
      : raffleNumbers.filter((number) => number.status === activeFilter)

  const reservedNumbers = raffleNumbers.filter(
    (number) => number.status === 'reservado',
  )
  const freeNumbers = raffleNumbers.filter((number) => number.status === 'livre')
  const paidNumbers = raffleNumbers.filter((number) => number.status === 'pago')
  const paidAmount = paidNumbers.length * ticketPrice
  const uniquePaidParticipants = new Set(
    paidNumbers
      .map((number) =>
        number.reservedByWhatsApp
          ? normalizeWhatsApp(number.reservedByWhatsApp)
          : '',
      )
      .filter((whatsApp): whatsApp is string => Boolean(whatsApp)),
  )
  const paidParticipantsCount = uniquePaidParticipants.size
  const isDrawUnlocked = paidNumbers.length === totalRaffleNumbers

  let raffleStatusMessage = 'Base pronta para sorteio.'

  if (paidNumbers.length === 0) {
    raffleStatusMessage = 'Ainda não há números pagos para sorteio.'
  } else if (paidParticipantsCount < totalPrizes) {
    raffleStatusMessage =
      'Ainda não há participantes únicos suficientes para todos os prêmios.'
  }

  const selectedNumberLabels = raffleNumbers
    .filter((number) => selectedNumbers.includes(number.id))
    .map((number) => number.label)

  const selectedTotal = selectedNumbers.length * ticketPrice
  const canConfirmReservation =
    selectedNumbers.length > 0 &&
    fullName.trim().length > 0 &&
    whatsApp.trim().length > 0

  function handleNumberClick(number: RaffleNumber) {
    if (number.status !== 'livre') {
      return
    }

    setLastReservation(null)

    setSelectedNumbers((current) => {
      const nextSelectedNumbers = current.includes(number.id)
        ? current.filter((id) => id !== number.id)
        : [...current, number.id]

      if (nextSelectedNumbers.length === 0) {
        setShowReservationForm(false)
      }

      return nextSelectedNumbers
    })
  }

  async function handleConfirmReservation() {
    if (!canConfirmReservation) {
      return
    }

    setReservationError('')

    const normalizedWhatsApp = normalizeWhatsApp(whatsApp)

    const reservationSnapshot = {
      selectedNumberLabels: [...selectedNumberLabels],
      fullName,
      whatsApp,
      total: selectedTotal,
    }

    const { data, error } = await supabase
      .from('raffle_numbers')
      .update({
        status: 'reservado',
        reserved_by_name: fullName,
        reserved_by_whatsapp: normalizedWhatsApp,
        updated_at: new Date().toISOString(),
      })
      .in('id', selectedNumbers)
      .eq('status', 'livre')
      .select('id, label, status, reserved_by_name, reserved_by_whatsapp')

    if (error) {
      setReservationError('Não foi possível concluir a reserva agora.')
      return
    }

    if (!data || data.length !== selectedNumbers.length) {
      setReservationError(
        'Um ou mais números já foram reservados. Atualize a página e escolha novamente.',
      )
      return
    }

    const updatedNumbers = data.flatMap((row) => {
      const mappedRow = mapSupabaseRaffleNumberRow(row)
      return mappedRow ? [mappedRow] : []
    })

    if (updatedNumbers.length !== selectedNumbers.length) {
      setReservationError(
        'Um ou mais números já foram reservados. Atualize a página e escolha novamente.',
      )
      return
    }

    setRaffleNumbers((current) =>
      current.map((number) =>
        updatedNumbers.find((updatedNumber) => updatedNumber.id === number.id) ??
        number,
      ),
    )

    setLastReservation(reservationSnapshot)
    setSelectedNumbers([])
    setShowReservationForm(false)
    setFullName('')
    setWhatsApp('')
  }

  async function handleReleaseNumber(id: number) {
    setAdminActionError('')

    const { data, error } = await supabase
      .from('raffle_numbers')
      .update({
        status: 'livre',
        reserved_by_name: null,
        reserved_by_whatsapp: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, label, status, reserved_by_name, reserved_by_whatsapp')
      .single()

    if (error || !data || !isValidNumberStatus(data.status)) {
      setAdminActionError('Não foi possível liberar o número agora.')
      return
    }

    const updatedNumber: RaffleNumber = {
      ...mapSupabaseRaffleNumberRow(data)!,
    }

    setRaffleNumbers((current) =>
      current.map((number) => (number.id === id ? updatedNumber : number)),
    )
  }

  async function handleMarkAsPaid(id: number) {
    setAdminActionError('')

    const { data, error } = await supabase
      .from('raffle_numbers')
      .update({
        status: 'pago',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, label, status, reserved_by_name, reserved_by_whatsapp')
      .single()

    if (error || !data || !isValidNumberStatus(data.status)) {
      setAdminActionError('Não foi possível marcar o número como pago.')
      return
    }

    const updatedNumber: RaffleNumber = {
      ...mapSupabaseRaffleNumberRow(data)!,
    }

    setRaffleNumbers((current) =>
      current.map((number) => (number.id === id ? updatedNumber : number)),
    )
  }

  async function handleRevertToReserved(id: number) {
    setAdminActionError('')

    const { data, error } = await supabase
      .from('raffle_numbers')
      .update({
        status: 'reservado',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('id, label, status, reserved_by_name, reserved_by_whatsapp')
      .single()

    if (error || !data || !isValidNumberStatus(data.status)) {
      setAdminActionError('Não foi possível voltar o número para reservado.')
      return
    }

    const updatedNumber: RaffleNumber = {
      ...mapSupabaseRaffleNumberRow(data)!,
    }

    setRaffleNumbers((current) =>
      current.map((number) => (number.id === id ? updatedNumber : number)),
    )
  }

  function handleAdminUnlock() {
    if (adminPasswordInput === adminPassword) {
      setAdminUnlocked(true)
      setAdminError('')
      return
    }

    setAdminUnlocked(false)
    setAdminError('Senha incorreta.')
  }

  async function handleRunDraw() {
    setDrawError('')

    if (!isDrawUnlocked) {
      setDrawError('Sorteio bloqueado até todos os números serem pagos.')
      return
    }

    const participantsMap = new Map<
      string,
      { fullName: string; whatsApp: string; numbers: RaffleNumber[] }
    >()

    for (const number of paidNumbers) {
      const normalizedWhatsApp = number.reservedByWhatsApp
        ? normalizeWhatsApp(number.reservedByWhatsApp)
        : ''

      if (!normalizedWhatsApp || !number.reservedByName) {
        continue
      }

      const currentParticipant = participantsMap.get(normalizedWhatsApp)

      if (currentParticipant) {
        currentParticipant.numbers.push(number)
        continue
      }

      participantsMap.set(normalizedWhatsApp, {
        fullName: number.reservedByName,
        whatsApp: normalizedWhatsApp,
        numbers: [number],
      })
    }

    const participants = Array.from(participantsMap.values())

    if (participants.length < totalPrizes) {
      setDrawError(
        'Ainda não há participantes únicos suficientes para todos os prêmios.',
      )
      return
    }

    const availableParticipants = [...participants]
    const winners: DrawWinner[] = []

    for (const prize of prizeLabels) {
      const participantIndex = Math.floor(
        Math.random() * availableParticipants.length,
      )
      const participant = availableParticipants[participantIndex]
      const numberIndex = Math.floor(
        Math.random() * participant.numbers.length,
      )
      const drawnNumber = participant.numbers[numberIndex]

      winners.push({
        prize,
        numberLabel: drawnNumber.label,
        fullName: participant.fullName,
        whatsApp: participant.whatsApp,
      })

      availableParticipants.splice(participantIndex, 1)
    }

    const { error } = await supabase.from('raffle_draw_results').insert(
      winners.map((winner) => ({
        prize: winner.prize,
        number_label: winner.numberLabel,
        full_name: winner.fullName,
        whatsapp: winner.whatsApp,
        created_at: new Date().toISOString(),
      })),
    )

    if (error) {
      setDrawError('Não foi possível salvar o resultado do sorteio.')
      return
    }

    setDrawResult(winners)
  }

  async function handleClearDrawResult() {
    setDrawError('')

    const { error } = await supabase
      .from('raffle_draw_results')
      .delete()
      .not('id', 'is', null)

    if (error) {
      setDrawError('Não foi possível limpar o resultado do sorteio.')
      return
    }

    setDrawResult(null)
  }

  function handleContinueReservation() {
    setShowReservationForm(true)
    reservationSummaryRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }

  return (
    <div className="page">
      {!isAdminView ? (
        <header className="hero">
          <div className="hero__eyebrow">Ação solidária</div>
          <h1>Rifa Solidária para Cirurgia</h1>
          <p className="hero__text">
            Escolha seus números, faça sua reserva e participe da rifa.
          </p>
      </header>
      ) : null}

      <main className="content">
        {raffleNumbersError ? <p>{raffleNumbersError}</p> : null}

        {!isAdminView ? (
          <>
            <section className="card">
              <div className="section-heading">
                <span className="section-heading__tag">Prêmios</span>
                <h2>Confira os prêmios da rifa</h2>
              </div>

              <div className="prize-list">
                <article className="prize-item">
                  <strong className="prize-rank prize-rank--top">🥇 1º prêmio</strong>
                  <p>Uma cesta básica</p>
                </article>
                <article className="prize-item">
                  <strong className="prize-rank prize-rank--top">🥈 2º prêmio</strong>
                  <p>Uma rede</p>
                </article>
                <article className="prize-item">
                  <strong className="prize-rank prize-rank--top">🥉 3º prêmio</strong>
                  <p>Uma selagem da Charmosa Beauty</p>
                </article>
                <article className="prize-item">
                  <strong className="prize-rank">4º prêmio</strong>
                  <p>Uma extensão de unhas da Ruth Elly</p>
                </article>
                <article className="prize-item">
                  <strong className="prize-rank">5º prêmio</strong>
                  <p>2 caixas de cerveja lata</p>
                </article>
                <article className="prize-item">
                  <strong className="prize-rank">6º prêmio</strong>
                  <p>Um pix de 100 reais</p>
                </article>
              </div>
            </section>

            <section className="card">
              <div className="section-heading">
                <span className="section-heading__tag">Filtros</span>
                <h2>Status dos números</h2>
              </div>

              <div className="filters" aria-label="Filtros de números">
                {filterOptions.map((filter) => (
                  <button
                    key={filter.value}
                    type="button"
                    className={
                      filter.value === activeFilter
                        ? 'filter-chip filter-chip--active'
                        : 'filter-chip'
                    }
                    onClick={() => setActiveFilter(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {isAdminMode ? (
          <section className="card">
            <div className="section-heading">
              <span className="section-heading__tag">Admin</span>
              <h2>Painel operacional</h2>
            </div>

            {!adminUnlocked ? (
              <div className="admin-gate">
                <label htmlFor="adminPassword">Senha de acesso</label>
                <input
                  id="adminPassword"
                  type="password"
                  value={adminPasswordInput}
                  onChange={(event) => setAdminPasswordInput(event.target.value)}
                  placeholder="Digite a senha"
                />
                <button
                  type="button"
                  className="admin-button admin-button--neutral"
                  onClick={handleAdminUnlock}
                >
                  Entrar
                </button>

                {adminError ? (
                  <p className="admin-gate__error">{adminError}</p>
                ) : null}
              </div>
            ) : (
              <>
                {adminActionError ? (
                  <p className="admin-action-error">{adminActionError}</p>
                ) : null}

                <div className="admin-summary">
                  <div className="admin-summary__item">
                    <span>Números livres</span>
                    <strong>{freeNumbers.length}</strong>
                  </div>
                  <div className="admin-summary__item">
                    <span>Números reservados</span>
                    <strong>{reservedNumbers.length}</strong>
                  </div>
                  <div className="admin-summary__item">
                    <span>Números pagos</span>
                    <strong>{paidNumbers.length}</strong>
                  </div>
                  <div className="admin-summary__item">
                    <span>Valor arrecadado</span>
                    <strong>{formatCurrency(paidAmount)}</strong>
                  </div>
                </div>

                <section className="admin-raffle">
                  <div className="section-heading">
                    <span className="section-heading__tag">Sorteio</span>
                    <h2>Base do sorteio</h2>
                  </div>

                  <div className="admin-raffle__summary">
                    <div className="admin-raffle__item">
                      <span>Números pagos</span>
                      <strong>
                        {paidNumbers.length} / {totalRaffleNumbers}
                      </strong>
                    </div>
                    <div className="admin-raffle__item">
                      <span>Participantes únicos</span>
                      <strong>{paidParticipantsCount}</strong>
                    </div>
                  </div>

                  <p className="admin-raffle__status">
                    {isDrawUnlocked
                      ? raffleStatusMessage
                      : 'Sorteio bloqueado até todos os números serem pagos.'}
                  </p>
                  <p className="admin-raffle__rule">
                    Cada participante pode ganhar no máximo 1 prêmio.
                  </p>

                  {drawError ? (
                    <p className="admin-raffle__error">{drawError}</p>
                  ) : null}

                  {isDrawUnlocked && !drawResult ? (
                    <button
                      type="button"
                      className="admin-button admin-button--success"
                      onClick={handleRunDraw}
                    >
                      Realizar sorteio
                    </button>
                  ) : null}

                  {drawResult ? (
                    <div className="admin-draw-result">
                      <div className="admin-draw-result__header">
                        <h3>Ganhadores sorteados</h3>
                        <button
                          type="button"
                          className="admin-button admin-button--neutral"
                          onClick={() => void handleClearDrawResult()}
                        >
                          Limpar resultado do sorteio
                        </button>
                      </div>

                      <div className="admin-list">
                        {drawResult.map((winner) => (
                          <article
                            key={winner.prize}
                            className="admin-list__item"
                          >
                            <div className="admin-list__info">
                              <strong>{winner.prize}</strong>
                              <p>Número: {winner.numberLabel}</p>
                              <p>{winner.fullName}</p>
                              <span>{winner.whatsApp}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>

                {reservedNumbers.length > 0 ? (
                  <div className="admin-list">
                    {reservedNumbers.map((number) => (
                      <article key={number.id} className="admin-list__item">
                        <div className="admin-list__info">
                          <strong>{number.label}</strong>
                          <p>{number.reservedByName ?? 'Sem nome'}</p>
                          <span>
                            {number.reservedByWhatsApp ?? 'Sem WhatsApp'}
                          </span>
                        </div>

                        <div className="admin-list__actions">
                          <button
                            type="button"
                            className="admin-button admin-button--neutral"
                            onClick={() => handleReleaseNumber(number.id)}
                          >
                            Liberar
                          </button>
                          <button
                            type="button"
                            className="admin-button admin-button--success"
                            onClick={() => handleMarkAsPaid(number.id)}
                          >
                            Marcar pago
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="admin-list__empty">Nenhuma reserva pendente.</p>
                )}

                <section className="admin-paid">
                  <div className="section-heading">
                    <span className="section-heading__tag">Pagos</span>
                    <h2>Números pagos</h2>
                  </div>

                  {paidNumbers.length > 0 ? (
                    <div className="admin-list">
                      {paidNumbers.map((number) => (
                        <article key={number.id} className="admin-list__item">
                          <div className="admin-list__info">
                            <strong>{number.label}</strong>
                            <p>{number.reservedByName ?? 'Sem nome'}</p>
                            <span>
                              {number.reservedByWhatsApp ?? 'Sem WhatsApp'}
                            </span>
                          </div>

                          <div className="admin-list__actions">
                            <button
                              type="button"
                              className="admin-button admin-button--neutral"
                              onClick={() => handleRevertToReserved(number.id)}
                            >
                              Voltar para reservado
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="admin-list__empty">Nenhum número pago ainda.</p>
                  )}
                </section>
              </>
            )}
          </section>
        ) : null}

        {!isAdminView ? (
          <section className="card">
            <div className="section-heading">
              <span className="section-heading__tag">Números</span>
              <h2>Seleção de números</h2>
            </div>

            <div ref={reservationSummaryRef} className="selection-summary">
              <h3>Minha reserva</h3>

              {selectedNumberLabels.length > 0 ? (
                <p className="selection-summary__numbers">
                  {selectedNumberLabels.join(', ')}
                </p>
              ) : (
                <p className="selection-summary__empty">
                  Nenhum número selecionado ainda.
                </p>
              )}

              <div className="selection-summary__meta">
                <div className="selection-summary__item">
                  <span>Quantidade selecionada</span>
                  <strong>{selectedNumbers.length}</strong>
                </div>
                <div className="selection-summary__item">
                  <span>Total a pagar</span>
                  <strong>{formatCurrency(selectedTotal)}</strong>
                </div>
              </div>
            </div>

            {selectedNumbers.length > 0 ? (
              <button
                type="button"
                className="reserve-button"
                onClick={handleContinueReservation}
              >
                Continuar reserva
              </button>
            ) : null}

            {showReservationForm ? (
              <form className="reservation-form">
                <h3>Identificação para reserva</h3>

                <div className="form-field">
                  <label htmlFor="fullName">Nome completo</label>
                  <input
                    id="fullName"
                    name="fullName"
                    type="text"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Digite seu nome completo"
                  />
                </div>

                <div className="form-field">
                  <label htmlFor="whatsApp">WhatsApp</label>
                  <input
                    id="whatsApp"
                    name="whatsApp"
                    type="tel"
                    value={whatsApp}
                    onChange={(event) => setWhatsApp(event.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>

                <button
                  type="button"
                  className="confirm-button"
                  disabled={!canConfirmReservation}
                  onClick={() => void handleConfirmReservation()}
                >
                  Confirmar reserva
                </button>

                {reservationError ? (
                  <p className="reservation-error">{reservationError}</p>
                ) : null}
              </form>
            ) : null}

            {lastReservation ? (
              <div className="reservation-summary">
                <h3>Reserva confirmada</h3>

                <div className="reservation-summary__item">
                  <span>Números</span>
                  <strong>{lastReservation.selectedNumberLabels.join(', ')}</strong>
                </div>

                <div className="reservation-summary__item">
                  <span>Nome</span>
                  <strong>{lastReservation.fullName}</strong>
                </div>

                <div className="reservation-summary__item">
                  <span>WhatsApp</span>
                  <strong>{lastReservation.whatsApp}</strong>
                </div>

                <div className="reservation-summary__item">
                  <span>Total a pagar</span>
                  <strong>{formatCurrency(lastReservation.total)}</strong>
                </div>

                <a
                  className="whatsapp-button"
                  href={buildWhatsAppLink(lastReservation)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Enviar reserva no WhatsApp
                </a>
              </div>
            ) : null}

            <div className="numbers-grid">
              {visibleNumbers.map((number) => (
                <button
                  key={number.id}
                  type="button"
                  className={`number-button number-button--${number.status}${
                    selectedNumbers.includes(number.id)
                      ? ' number-button--selected'
                      : ''
                  }`}
                  aria-label={`${number.label} - ${number.status}`}
                  aria-pressed={selectedNumbers.includes(number.id)}
                  onClick={() => handleNumberClick(number)}
                >
                  {number.label}
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </main>

      {selectedNumbers.length > 0 && !isAdminView ? (
        <div className="floating-reservation-bar">
          <div className="floating-reservation-bar__info">
            <span>{selectedNumbers.length} selecionado(s)</span>
            <strong>{formatCurrency(selectedTotal)}</strong>
          </div>

          <button
            type="button"
            className="floating-reservation-bar__button"
            onClick={handleContinueReservation}
          >
            Continuar reserva
          </button>
        </div>
      ) : null}

      <footer className="footer">
        <p>Rifa Solidária para Cirurgia</p>
      </footer>
    </div>
  )
}

export default App
