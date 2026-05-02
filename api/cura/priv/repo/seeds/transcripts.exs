defmodule Cura.Repo.Seeds.Transcripts do
  @moduledoc """
  Seeds realistic European-Portuguese transcripts for completed meetings.

  Each completed meeting that doesn't yet have any transcript entries gets a
  random consultation template applied — entries are inserted in order with
  staggered `inserted_at` values so the UI shows a credible progression.

  Re-running the script is safe: meetings that already have transcripts are
  skipped, and only new completed meetings (e.g. visits the doctor finished
  today) get seeded.
  """

  alias Cura.Meetings.{Meeting, TranscriptEntry}
  alias Cura.Repo

  import Ecto.Query

  # Average gap between utterances, in seconds. Real consultations are
  # bursty, but a uniform 25-40 s spread keeps the transcript readable
  # and lands every entry comfortably inside the meeting's duration window.
  @gap_seconds_min 25
  @gap_seconds_max 45

  # Each template is a list of {speaker, text}. Speaker alternation is
  # deliberate but not strict — real visits have the doctor speaking twice
  # to clarify a point, so the templates can break the pattern when natural.
  @templates [
    # ── 1. Hipertensão arterial — seguimento ────────────────────────────────
    %{
      title: "Hipertensão arterial — seguimento",
      lines: [
        {:doctor, "Bom dia, faça favor de se sentar."},
        {:patient, "Bom dia, doutor. Obrigada."},
        {:doctor, "Então, como é que se tem sentido desde a última consulta?"},
        {:patient,
         "Tenho-me sentido um bocadinho mais cansada. E a tensão tem andado mais alta nas medições em casa."},
        {:doctor, "Tem o registo aí consigo?"},
        {:patient,
         "Tenho, sim. Andou quase sempre entre 14/9 e 15/10, sobretudo de manhã."},
        {:doctor,
         "Está mesmo acima do que devíamos ter. Continua a tomar o lisinopril 10 mg ao pequeno-almoço?"},
        {:patient, "Tomo, sim. Mas confesso que ao fim-de-semana às vezes me esqueço."},
        {:doctor, "E a alimentação? Tem reduzido o sal?"},
        {:patient, "Tenho tentado, mas no Natal exagerei e ganhei dois quilos."},
        {:doctor, "Tem tido dores de cabeça, tonturas, alterações da visão?"},
        {:patient, "Só dores de cabeça à tarde, principalmente quando estou ao computador."},
        {:doctor,
         "Vamos fazer o seguinte: aumentamos o lisinopril para 20 mg de manhã e mantém o registo durante quatro semanas. Mais análises ao perfil renal e ionograma."},
        {:patient, "E o colesterol? A última vez tinha estado um pouco alto."},
        {:doctor, "Boa ideia. Aproveitamos para repetir o perfil lipídico."},
        {:patient, "Está bem. E se a tensão não baixar?"},
        {:doctor,
         "Voltamos a falar dentro de um mês. Se for preciso associamos um diurético em dose baixa, mas vamos com calma."},
        {:patient, "Combinado, doutor. Muito obrigada."},
        {:doctor, "De nada. Cuide-se e qualquer coisa contacte o consultório."}
      ]
    },

    # ── 2. Diabetes tipo 2 — revisão ────────────────────────────────────────
    %{
      title: "Diabetes tipo 2 — revisão",
      lines: [
        {:doctor, "Bom dia. Trouxe as análises que pedimos da última vez?"},
        {:patient, "Trouxe, doutor. Está aqui."},
        {:doctor, "A hemoglobina glicada subiu — está em 8,4. Da última estava em 7,3."},
        {:patient,
         "Eu sei. Sinceramente, tenho andado a comer pior. O trabalho mudou e quase não almoço em casa."},
        {:doctor, "Tem feito glicémias capilares em casa?"},
        {:patient, "Faço de manhã em jejum. Anda quase sempre acima de 160."},
        {:doctor, "E sintomas de descompensação? Sede, urinar muito, perda de peso?"},
        {:patient, "Acordo várias vezes durante a noite para ir à casa de banho."},
        {:doctor, "Está a tomar metformina 1000 mg duas vezes ao dia, certo?"},
        {:patient, "Sim, sempre. Não falho a medicação."},
        {:doctor,
         "Pelos números, vamos precisar de reforçar. Penso em associar um inibidor SGLT2 — o objetivo é reduzir a glicada e proteger o rim."},
        {:patient, "Tem efeitos secundários?"},
        {:doctor,
         "Pode aumentar ligeiramente o risco de infeções urinárias. Beba água ao longo do dia e cuide da higiene."},
        {:patient, "Está bem. E em relação à alimentação?"},
        {:doctor,
         "Vou referenciá-la à nutricionista. Reduzir os hidratos de absorção rápida e estabelecer rotinas é o mais importante."},
        {:patient, "Combinado. E daqui a quanto tempo volto?"},
        {:doctor, "Repetimos a glicada e a função renal em três meses. Se houver descontrolo, antes."}
      ]
    },

    # ── 3. Tosse e febre — provável pneumonia ───────────────────────────────
    %{
      title: "Tosse persistente com febre",
      lines: [
        {:doctor, "Boa tarde. Diga-me o que o trouxe cá hoje."},
        {:patient,
         "Tenho uma tosse que não passa há quatro dias, doutor. E tive febre alta no fim-de-semana — chegou aos 39."},
        {:doctor, "A febre cedeu com paracetamol?"},
        {:patient, "Cedia, mas voltava ao fim de seis ou sete horas."},
        {:doctor, "Tem expectoração? De que cor?"},
        {:patient, "Sim, esverdeada. E sinto um aperto no peito do lado direito quando respiro fundo."},
        {:doctor,
         "Vou auscultá-lo. Faça favor de tirar a camisola. Respire fundo pela boca, devagar..."},
        {:doctor, "Ouço fervores no terço inferior direito. Vamos pedir uma radiografia ao tórax já hoje."},
        {:patient, "É grave?"},
        {:doctor,
         "Provavelmente é uma pneumonia. Com antibiótico oral e repouso resolve-se em dez a catorze dias."},
        {:patient, "Posso fazer a radiografia aqui?"},
        {:doctor, "Sim, vou passar-lhe a credencial agora."},
        {:doctor,
         "Receito-lhe amoxicilina-clavulanato 875/125 de 12 em 12 horas durante sete dias, e paracetamol em SOS para a febre."},
        {:patient, "E se piorar?"},
        {:doctor,
         "Se a febre não baixar em 48 horas, ou se a falta de ar piorar, vai diretamente à urgência. Não espere."},
        {:patient, "Está bem, doutor. Obrigado."},
        {:doctor, "Não se esqueça da hidratação. Daqui a uma semana volta cá para vermos a evolução."}
      ]
    },

    # ── 4. Lombalgia ────────────────────────────────────────────────────────
    %{
      title: "Lombalgia mecânica",
      lines: [
        {:doctor, "Faça favor. Diga-me o que se passa."},
        {:patient, "Acordei há três dias com a coluna travada. Não consigo dobrar-me para apertar os sapatos."},
        {:doctor, "Tem irradiação para a perna? Adormecimento?"},
        {:patient, "Não. A dor é só nos rins, mais do lado esquerdo."},
        {:doctor, "Lembra-se de algum esforço, alguma queda?"},
        {:patient, "Estive a mudar móveis na casa nova no domingo. Acho que foi aí."},
        {:doctor, "A dor melhora com o calor, com o repouso?"},
        {:patient, "Sim, sobretudo se ponho um saco de água quente. Quando me levanto da cadeira é o pior."},
        {:doctor, "Vamos fazer alguns testes. Levante a perna esticada... agora a outra."},
        {:patient, "Não dói, só sinto a tensão a puxar."},
        {:doctor,
         "É uma lombalgia mecânica clássica. Não há sinais de raiz comprimida, por isso não vamos pedir exames de imagem."},
        {:patient, "Não preciso de fazer ressonância?"},
        {:doctor,
         "Não, neste momento não traz benefício. Receito ibuprofeno 600 mg de 8 em 8 horas durante cinco dias e tizanidina à noite."},
        {:patient, "E exercício, posso fazer?"},
        {:doctor, "Não fique parado em repouso. Caminhar é bom. Evite só carregar pesos esta semana."},
        {:patient, "Combinado. Se não melhorar?"},
        {:doctor,
         "Se em duas semanas continuar igual, ou se aparecer dormência ou perda de força, voltamos a avaliar e ponderamos fisioterapia."},
        {:patient, "Está bem, doutor. Obrigado."}
      ]
    },

    # ── 5. Cefaleias / enxaquecas ──────────────────────────────────────────
    %{
      title: "Cefaleias frequentes",
      lines: [
        {:doctor, "Bom dia. Veio por causa das dores de cabeça?"},
        {:patient,
         "Sim, doutora. Têm-se tornado mais frequentes — quase três vezes por semana. E são muito fortes."},
        {:doctor, "Onde dói? De que lado?"},
        {:patient, "É sempre do lado direito, atrás do olho. Pulsa, como se fosse o coração ali."},
        {:doctor, "Quanto tempo dura cada crise?"},
        {:patient, "Quatro, cinco horas se não tomar nada."},
        {:doctor, "Tem náuseas? A luz e o som incomodam?"},
        {:patient,
         "Sim, fico enjoada. E preciso mesmo de me deitar no escuro, qualquer barulho irrita-me."},
        {:doctor, "Identifica algum gatilho? Falta de sono, café, vinho?"},
        {:patient,
         "Reparei que aparecem mais quando durmo pouco e durante o ciclo. Vinho tinto também me parece piorar."},
        {:doctor, "Está a tomar algum analgésico em SOS?"},
        {:patient, "Tomo paracetamol, mas só tira metade da dor."},
        {:doctor,
         "São crises de enxaqueca, com aura sensorial. Vamos passar para um triptano — sumatriptano 50 mg ao primeiro sinal."},
        {:patient, "E para prevenir?"},
        {:doctor,
         "Se mantiver mais de quatro crises por mês, podemos iniciar profilaxia com propranolol em dose baixa."},
        {:patient, "Não preciso de fazer TAC ao crânio?"},
        {:doctor,
         "Pelos sintomas e pelo padrão, não. Os exames de imagem só fazem sentido se houver sinais de alarme — alterações neurológicas, dor diferente do habitual."},
        {:patient, "Está bem. Obrigada, doutora."},
        {:doctor, "Mantenha um diário das crises e voltamos a ver-nos dentro de seis semanas."}
      ]
    },

    # ── 6. Refluxo gastroesofágico ─────────────────────────────────────────
    %{
      title: "Pirose recorrente",
      lines: [
        {:doctor, "Bom dia. Diga-me as queixas."},
        {:patient,
         "Tenho azia praticamente todas as noites, doutor. Acordo a tossir e às vezes parece que me sobe ácido à garganta."},
        {:doctor, "Há quanto tempo é que isto se arrasta?"},
        {:patient, "Há uns três meses, mas agravou no último mês."},
        {:doctor, "Já tomou algum antiácido?"},
        {:patient, "Tomei almagato em saqueta. Alivia na hora mas volta."},
        {:doctor, "Que tipo de refeições é que pioram?"},
        {:patient, "Quando como tarde, sobretudo se for esparguete com molho de tomate ou comida picante."},
        {:doctor, "Fuma? Bebe café à noite?"},
        {:patient, "Fumo cerca de dez cigarros por dia. E sim, costumo tomar um cafezinho depois de jantar."},
        {:doctor, "Perda de peso, dificuldade em engolir, vómitos com sangue?"},
        {:patient, "Não, nada disso."},
        {:doctor,
         "É um quadro típico de refluxo gastroesofágico. Vamos tratar com pantoprazol 40 mg em jejum durante oito semanas."},
        {:patient, "E a comida? Tenho de cortar tudo?"},
        {:doctor,
         "O essencial é não jantar tarde — pelo menos três horas antes de se deitar — e elevar a cabeceira da cama. Reduzir café e álcool ajuda muito."},
        {:patient, "E o tabaco?"},
        {:doctor,
         "É outro fator importante. Posso encaminhá-lo à consulta de cessação tabágica se quiser apoio."},
        {:patient, "Vou pensar. E se não melhorar?"},
        {:doctor, "Se em dois meses os sintomas persistirem, pedimos uma endoscopia digestiva alta."},
        {:patient, "Combinado. Obrigado, doutor."}
      ]
    },

    # ── 7. Ansiedade e insónia ─────────────────────────────────────────────
    %{
      title: "Ansiedade e insónia",
      lines: [
        {:doctor, "Faça favor de se sentar. Como é que se tem sentido?"},
        {:patient,
         "Mais ansiosa, doutora. Tenho dificuldade em adormecer e acordo às quatro da manhã sem voltar a dormir."},
        {:doctor, "Há quanto tempo é que isto começou?"},
        {:patient, "Desde que mudei de emprego, em outubro. Sinto-me sempre em alerta."},
        {:doctor, "Tem palpitações, sensação de falta de ar, tonturas?"},
        {:patient,
         "Tenho. Às vezes no metro fico com o coração a galope e tenho de sair na estação seguinte."},
        {:doctor, "E os pensamentos? Conseguem desligar à noite?"},
        {:patient, "Não. Fico a remoer no que tenho de fazer no dia seguinte."},
        {:doctor, "Está a usar algum medicamento para dormir?"},
        {:patient, "Tomei umas valerianas que a vizinha me deu, mas sem grande efeito."},
        {:doctor,
         "O quadro é compatível com ansiedade generalizada e insónia secundária. Quero seguir uma abordagem em duas frentes."},
        {:patient, "Não quero ficar dependente de comprimidos."},
        {:doctor,
         "Compreendo. Vou propor escitalopram 10 mg de manhã, que não cria dependência, e uma referenciação a psicologia para terapia cognitivo-comportamental."},
        {:patient, "E para dormir?"},
        {:doctor,
         "Damos uma janela curta de zolpidem em SOS — só nas primeiras duas semanas, para quebrar o ciclo. Não é para usar todas as noites."},
        {:patient, "Está bem."},
        {:doctor,
         "Higiene do sono é meio caminho andado: deite-se à mesma hora, tire o telemóvel do quarto, não veja ecrãs uma hora antes."},
        {:patient, "Vou tentar. Volto quando?"},
        {:doctor, "Daqui a três semanas, para vermos a tolerância ao escitalopram."}
      ]
    }
  ]

  def run do
    seeded_meeting_ids =
      Repo.all(from te in TranscriptEntry, distinct: te.meeting_id, select: te.meeting_id)
      |> MapSet.new()

    completed =
      Repo.all(
        from m in Meeting,
          where: m.status == :completed,
          select: %{id: m.id, date: m.date, time: m.time}
      )

    needs = Enum.reject(completed, &MapSet.member?(seeded_meeting_ids, &1.id))

    cond do
      completed == [] ->
        IO.puts("No completed meetings found; seed meetings first.")

      needs == [] ->
        IO.puts("All completed meetings already have transcripts, skipping seeding.")

      true ->
        seed(needs)
    end
  end

  defp seed(meetings) do
    rows =
      meetings
      |> Enum.flat_map(&build_rows/1)

    {count, _} = Repo.insert_all(TranscriptEntry, rows)
    Mix.shell().info("Seeded #{count} transcript entries across #{length(meetings)} meeting(s).")
  end

  defp build_rows(%{id: meeting_id, date: date, time: time}) do
    template = Enum.random(@templates)
    {:ok, base} = NaiveDateTime.new(date, time)

    template.lines
    |> Enum.with_index()
    |> Enum.map_reduce(0, fn {{speaker, text}, _idx}, offset ->
      gap = Enum.random(@gap_seconds_min..@gap_seconds_max)
      offset = offset + gap
      inserted_at = NaiveDateTime.add(base, offset, :second) |> trim_usec()

      row = %{
        id: Ecto.UUID.generate(),
        meeting_id: meeting_id,
        speaker: speaker,
        text: text,
        inserted_at: inserted_at
      }

      {row, offset}
    end)
    |> elem(0)
  end

  defp trim_usec(%NaiveDateTime{} = naive),
    do: %{naive | microsecond: {0, 0}}
end

Cura.Repo.Seeds.Transcripts.run()
